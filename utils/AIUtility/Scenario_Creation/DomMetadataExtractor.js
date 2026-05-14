'use strict';

/**
 * DomMetadataExtractor.js
 *
 * TRULY GENERIC DOM metadata extraction utility.
 * Works with any web framework or plain HTML:
 *   - Plain HTML5 forms
 *   - Angular / Angular Material (mat-select, mat-radio-group, mat-checkbox, formcontrolname)
 *   - AngularJS (ng-model, ng-required, ng-minlength)
 *   - React (controlled inputs, custom dropdowns)
 *   - Vue (v-model, custom components)
 *   - Bootstrap (form-control, form-check, collapse)
 *   - Ant Design / MUI / Semantic UI (custom dropdown patterns)
 *   - Any ARIA-compliant custom component (role="combobox/listbox/option/radio/switch")
 *
 * KEY DESIGN RULE — Hidden sections are NEVER removed:
 *   A section hidden at page load (display:none, [hidden], aria-hidden, .d-none, etc.)
 *   may appear when the user selects a trigger value (e.g. "Yes" → factory address appears).
 *   These sections are extracted and tagged  conditionallyHidden: true  so the AI knows
 *   they exist and can generate dependency-aware scenarios for them.
 *
 * What IS stripped (true noise — zero test value regardless of framework):
 *   <style>, <script>, <svg>, <noscript>, <link>, <meta>, <head> content,
 *   tooltip/popover overlay containers, screen-reader-only utility spans.
 *
 * Usage:
 *   const DomMetadataExtractor = require('./DomMetadataExtractor');
 *   const metadata = DomMetadataExtractor.extract(rawHtmlString);
 */

const cheerio = require('cheerio');

// ─────────────────────────────────────────────────────────────────────────────
// Framework-agnostic attribute readers
// These cover every major framework's way of naming / binding a field.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the best available field identifier from an element.
 * Priority: name → id → formcontrolname (Angular) → ng-model (AngularJS)
 *           → v-model (Vue) → data-field → data-name → aria-label
 */
function fieldId($el) {
    return $el.attr('name')
        || $el.attr('id')
        || $el.attr('formcontrolname')   // Angular reactive forms
        || $el.attr('ng-model')          // AngularJS
        || $el.attr('v-model')           // Vue
        || $el.attr('data-field')
        || $el.attr('data-name')
        || $el.attr('aria-label')
        || '';
}

/**
 * Returns true if an attribute is present (value may be empty string or "true").
 */
function hasAttr($el, attr) {
    return $el.attr(attr) !== undefined;
}

/**
 * Reads a validation constraint from multiple framework attribute variants.
 * e.g. maxlength="50" | ng-maxlength="50" | data-maxlength="50"
 */
function validationAttr($el, base) {
    return $el.attr(base)
        || $el.attr(`ng-${base}`)        // AngularJS
        || $el.attr(`data-${base}`)      // generic data-* fallback
        || null;
}

class DomMetadataExtractor {

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Main entry point. Converts raw HTML into structured metadata JSON.
     * @param {string} dom - Raw HTML string
     * @returns {{
     *   pageInfo:     object,
     *   inputs:       Array,
     *   dropdowns:    Array,
     *   radioGroups:  Array,
     *   checkboxes:   Array,
     *   buttons:      Array,
     *   validations:  Array,
     *   dependencies: Array
     * }}
     */
    static extract(dom) {
        if (!dom || typeof dom !== 'string') {
            return DomMetadataExtractor._emptyResult();
        }

        const $ = DomMetadataExtractor._load(dom);

        const rawMetadata = {
            pageInfo:     DomMetadataExtractor._extractPageInfo($),
            inputs:       DomMetadataExtractor._extractInputs($),
            dropdowns:    DomMetadataExtractor._extractDropdowns($),
            radioGroups:  DomMetadataExtractor._extractRadioGroups($),
            checkboxes:   DomMetadataExtractor._extractCheckboxes($),
            buttons:      DomMetadataExtractor._extractButtons($),
            validations:  DomMetadataExtractor._extractValidations($),
            dependencies: DomMetadataExtractor._extractDependencies($),
        };

        // Optimize metadata automatically (remove Angular IDs, detect patterns, compress)
        return DomMetadataExtractor._optimizeMetadata(rawMetadata);
    }

    /**
     * Identify fields that should be used for combinatorial matrix generation.
     * Includes dropdowns and radio groups with a reasonable number of options.
     */
    static getCategoricalFields(metadata) {
        const fields = [
            ...(metadata.dropdowns || []),
            ...(metadata.radioGroups || [])
        ];

        // Filter for fields that have between 2 and 10 options (too many options break the matrix)
        return fields.filter(f => f.options && f.options.length >= 2 && f.options.length <= 12);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPER — Module name inference (framework-agnostic)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Infers the module/section name from the most prominent heading in the DOM.
     * Covers: plain HTML headings, fieldset legends, Bootstrap card titles,
     * Angular Material card titles, MUI/Ant Design panel headers, custom title classes.
     */
    static inferModuleName($) {
        const candidates = [
            // Standard semantic headings — highest priority
            $('h1').first().text().trim(),
            $('h2').first().text().trim(),
            $('legend').first().text().trim(),
            // Framework component title elements
            $('mat-card-title').first().text().trim(),          // Angular Material
            $('[class*="card-title"]').first().text().trim(),   // Bootstrap / custom
            $('[class*="panel-title"]').first().text().trim(),  // Bootstrap panels
            $('[class*="form-title"]').first().text().trim(),
            $('[class*="page-title"]').first().text().trim(),
            $('[class*="section-title"]').first().text().trim(),
            $('[class*="modal-title"]').first().text().trim(),  // Bootstrap modals
            $('[class*="drawer-title"]').first().text().trim(), // MUI drawer
            $('[class*="dialog-title"]').first().text().trim(), // MUI dialog
            // Form-level labels
            $('form[aria-label]').attr('aria-label') || '',
            $('form[title]').attr('title') || '',
            $('form[name]').attr('name') || '',
            // Fallback: first h3
            $('h3').first().text().trim(),
        ];

        for (const c of candidates) {
            const clean = (c || '').replace(/\s+/g, ' ').trim();
            if (clean && clean.length > 2 && clean.length < 80) {
                return clean;
            }
        }

        return 'Application Form';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE — DOM loader & noise stripper (framework-agnostic)
    // ─────────────────────────────────────────────────────────────────────────

    static _load(dom) {
        const $ = cheerio.load(dom, { decodeEntities: false });

        // ── Strip TRUE noise only ─────────────────────────────────────────────
        // Only remove elements that can NEVER contain form fields or test-relevant
        // content, regardless of framework. DO NOT remove anything based on
        // visibility — hidden sections may be conditionally shown by JS.

        // Inert resource/style elements
        $('style, script, noscript, link, meta').remove();

        // SVG — decorative icons only; never contain form fields
        $('svg').remove();

        // Tooltip / popover overlay containers (framework-specific but safe to remove
        // because they are always empty clones rendered outside the form DOM)
        // Angular CDK
        $('[class*="cdk-overlay-container"]').remove();
        $('[class*="cdk-visually-hidden"]').remove();
        $('mat-tooltip-component').remove();
        // Bootstrap tooltip/popover wrappers
        $('[class*="tooltip"]').not('[data-bs-toggle]').not('[title]').remove();
        $('[class*="popover"]').not('[data-bs-toggle]').remove();
        // Generic screen-reader-only utility spans (1px off-screen, no visual content)
        $('[class="sr-only"], [class="visually-hidden"]').remove();

        return $;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION EXTRACTORS
    // ─────────────────────────────────────────────────────────────────────────

    /** PAGE INFO — framework-agnostic */
    static _extractPageInfo($) {
        const pageTitle = $('title').text().trim()
            || $('h1').first().text().trim()
            || '';

        const headings = [];
        // Covers: plain HTML, Angular Material, Bootstrap, MUI, Ant Design, custom classes
        const headingSelector = [
            'h1, h2, h3, legend',
            'mat-card-title',                    // Angular Material
            '[class*="card-title"]',             // Bootstrap / custom
            '[class*="panel-title"]',            // Bootstrap panels
            '[class*="section-title"]',
            '[class*="section-header"]',
            '[class*="form-heading"]',
            '[class*="form-title"]',
            '[class*="page-heading"]',
            '[class*="modal-title"]',            // Bootstrap / MUI modals
            '[class*="drawer-title"]',           // MUI drawer
            '[role="heading"]',                  // ARIA heading role
        ].join(', ');

        $(headingSelector).each((_, el) => {
            const text = $(el).text().replace(/\s+/g, ' ').trim();
            if (text && text.length > 1 && !headings.includes(text)) {
                headings.push(text);
            }
        });

        return {
            pageTitle,
            moduleName: DomMetadataExtractor.inferModuleName($),
            headings,
        };
    }

    /** INPUT FIELDS — framework-agnostic (text, email, number, tel, date, password, textarea) */
    static _extractInputs($) {
        const inputs = [];
        const seen = new Set();

        const processInput = (el) => {
            const $el = $(el);
            const tag  = (el.tagName || '').toLowerCase();
            const type = ($el.attr('type') || (tag === 'textarea' ? 'textarea' : 'text')).toLowerCase();

            // Skip non-data input types — handled by other extractors or irrelevant
            if (['radio', 'checkbox', 'submit', 'button', 'reset', 'hidden', 'file', 'image'].includes(type)) return;

            // Framework-agnostic field identifier
            const name = fieldId($el);
            const id   = $el.attr('id') || '';

            // Deduplicate
            const key = `${name}|${id}`;
            if (seen.has(key) && key !== '|') return;
            seen.add(key);

            // Required — HTML5 + AngularJS + Vue + data-* fallback
            const required = hasAttr($el, 'required')
                || $el.attr('ng-required') === 'true'
                || $el.attr('data-required') === 'true'
                || $el.attr('aria-required') === 'true';

            const placeholder = $el.attr('placeholder') || '';
            const minlength   = validationAttr($el, 'minlength');
            const maxlength   = validationAttr($el, 'maxlength');
            const pattern     = $el.attr('pattern') || $el.attr('data-pattern') || null;
            const min         = $el.attr('min') || null;
            const max         = $el.attr('max') || null;
            const step        = $el.attr('step') || null;
            const autocomplete = $el.attr('autocomplete') || null;

            const label = DomMetadataExtractor._resolveLabel($, el);

            const entry = { name, id, type, required, label };
            if (placeholder)   entry.placeholder   = placeholder;
            if (minlength)     entry.minlength     = minlength;
            if (maxlength)     entry.maxlength     = maxlength;
            if (pattern)       entry.pattern       = pattern;
            if (min)           entry.min           = min;
            if (max)           entry.max           = max;
            if (step)          entry.step          = step;
            if (autocomplete)  entry.autocomplete  = autocomplete;

            // Tag fields inside conditionally hidden sections
            if (DomMetadataExtractor._isConditionallyHidden($, el)) {
                entry.conditionallyHidden = true;
            }

            inputs.push(entry);
        };

        $('input, textarea').each((_, el) => processInput(el));

        return inputs;
    }

    /**
     * DROPDOWNS — fully framework-agnostic.
     *
     * Covers:
     *   1. Native <select> / <option>
     *   2. Angular Material  mat-select / mat-option
     *   3. ARIA              role="combobox" / role="listbox" / role="option"
     *   4. Custom data-*     data-options, data-choices (common in jQuery plugins)
     *   5. React-Select / Ant Design / MUI Select — detected via ARIA roles
     *   6. Bootstrap Select  — detected via .dropdown-item inside .dropdown
     *   7. Semantic UI       — .ui.dropdown > .item
     */
    static _extractDropdowns($) {
        const dropdowns = [];
        const seen = new Set();

        const addDropdown = (fieldName, options, el) => {
            if (!fieldName || seen.has(fieldName)) return;
            seen.add(fieldName);
            const entry = { fieldName, options };
            if (DomMetadataExtractor._isConditionallyHidden($, el)) entry.conditionallyHidden = true;
            dropdowns.push(entry);
        };

        // ── 1. Native <select> ───────────────────────────────────────────────
        $('select').each((_, el) => {
            const $el = $(el);
            const name = fieldId($el) || DomMetadataExtractor._resolveLabel($, el) || 'unknown';
            const options = [];
            $el.find('option').each((_, opt) => {
                const val = $(opt).text().trim();
                const v   = ($(opt).attr('value') || '').trim();
                // Skip placeholder options (empty value or generic "select" text)
                if (!val) return;
                const lower = val.toLowerCase();
                if (['select', '--select--', 'please select', '-- select --',
                     'choose', '-- choose --', 'none', '-'].includes(lower)) return;
                if (v === '' && lower.startsWith('select')) return;
                options.push(val);
            });
            addDropdown(name, options, el);
        });

        // ── 2. Angular Material mat-select ───────────────────────────────────
        $('mat-select').each((_, el) => {
            const $el = $(el);

            // Angular Material mat-select field name resolution:
            // 1. formcontrolname (present on some mat-selects, e.g. grievance form)
            // 2. aria-labelledby → points to mat-label element text (most common)
            //    Note: aria-labelledby is space-separated: "label-id value-id"
            //    The label-id points to the mat-label, value-id to the selected value span.
            //    We want the FIRST id which is always the label.
            // 3. name attr
            // 4. id attr (mat-select-N — not useful as a field name)
            let name = $el.attr('formcontrolname') || $el.attr('name') || '';

            if (!name) {
                const labelledBy = $el.attr('aria-labelledby') || '';
                const firstLabelId = labelledBy.split(' ')[0];
                if (firstLabelId) {
                    const labelText = $(`#${firstLabelId}`).text().replace(/\s+/g, ' ').trim()
                        .replace(/\s*\*$/, '').trim(); // strip trailing asterisk
                    if (labelText) name = labelText;
                }
            }

            if (!name) name = $el.attr('id') || 'unknown';

            if (seen.has(name)) return;
            seen.add(name);

            const options = [];

            // mat-option may be inside mat-form-field (rare in static snapshots)
            const $matField = $el.closest('mat-form-field');
            const $scope    = $matField.length ? $matField : $el.parent();
            $scope.find('mat-option').each((_, opt) => {
                const val = $(opt).text().trim();
                if (val) options.push(val);
            });

            // Fallback: aria-owns / aria-controls panel id
            if (options.length === 0) {
                const panelId = $el.attr('aria-owns') || $el.attr('aria-controls') || '';
                if (panelId) {
                    $(`#${panelId}`).find('mat-option, [role="option"]').each((_, opt) => {
                        const val = $(opt).text().trim();
                        if (val) options.push(val);
                    });
                }
            }

            // Capture required status from aria-required
            const required = $el.attr('aria-required') === 'true' || hasAttr($el, 'required');

            const entry = { fieldName: name, options, required };
            if (!required) delete entry.required; // keep output clean
            if (DomMetadataExtractor._isConditionallyHidden($, el)) entry.conditionallyHidden = true;
            dropdowns.push(entry);
        });

        // ── 3. ARIA combobox / listbox (React-Select, MUI, Ant Design, etc.) ─
        $('[role="combobox"], [role="listbox"]').each((_, el) => {
            const $el = $(el);
            // Skip if already captured as mat-select or Bootstrap dropdown
            if (el.tagName && el.tagName.toLowerCase() === 'mat-select') return;
            if ($el.closest('[class*="dropdown"]').length > 0 && !hasAttr($el, 'data-value')) return;
            
            // ── NEW: Skip internal listboxes (double-counting) ──
            // If this listbox is inside another listbox/combobox, skip it.
            if ($el.parents('[role="combobox"], [role="listbox"]').length > 0) return;

            const name = $el.attr('aria-label')
                || ($el.attr('aria-labelledby') ? $(`#${$el.attr('aria-labelledby')}`).text().trim() : '')
                || fieldId($el)
                || 'unknown';

            const options = [];
            // Options may be direct children or in an aria-owns/controls panel
            const ownedId = $el.attr('aria-owns') || $el.attr('aria-controls') || '';
            const $scope  = ownedId ? $(`#${ownedId}`) : $el;
            $scope.find('[role="option"]').each((_, opt) => {
                const val = $(opt).text().trim();
                if (val) options.push(val);
            });

            if (options.length > 0) addDropdown(name, options, el);
        });

        // ── 4. Bootstrap .dropdown with .dropdown-item children ──────────────
        $('[class*="dropdown"]').each((_, el) => {
            const $el = $(el);
            // Must have dropdown-item children and a visible toggle label
            const $items = $el.find('[class*="dropdown-item"]');
            if ($items.length === 0) return;

            const $toggle = $el.find('[data-bs-toggle="dropdown"], [data-toggle="dropdown"]').first();
            const name = $toggle.text().trim()
                || $el.attr('id')
                || $el.attr('aria-label')
                || 'unknown';

            if (seen.has(name)) return;

            const options = [];
            $items.each((_, item) => {
                const val = $(item).text().trim();
                if (val) options.push(val);
            });

            if (options.length > 0) addDropdown(name, options, el);
        });

        // ── 5. Semantic UI .ui.dropdown > .item ──────────────────────────────
        $('[class*="ui"][class*="dropdown"]').each((_, el) => {
            const $el = $(el);
            const $items = $el.find('.item');
            if ($items.length === 0) return;

            const name = $el.find('.text').first().text().trim()
                || fieldId($el)
                || 'unknown';

            if (seen.has(name)) return;

            const options = [];
            $items.each((_, item) => {
                const val = $(item).text().trim();
                if (val) options.push(val);
            });

            if (options.length > 0) addDropdown(name, options, el);
        });

        return dropdowns;
    }

    /**
     * RADIO GROUPS — framework-agnostic.
     * Covers: native <input type="radio">, Angular Material mat-radio-group/mat-radio-button,
     * ARIA role="radiogroup"/role="radio", custom data-type="radio" patterns.
     */
    static _extractRadioGroups($) {
        const groups = {};

        const addOption = (groupName, label, isHidden) => {
            if (!groups[groupName]) {
                groups[groupName] = { fieldName: groupName, options: [], conditionallyHidden: isHidden };
            }
            const cleanLabel = label.trim().replace(/\s*\*$/, ''); // Strip asterisks
            if (cleanLabel && !groups[groupName].options.includes(cleanLabel)) {
                groups[groupName].options.push(cleanLabel);
            }
        };

        // ── Native <input type="radio"> ──────────────────────────────────────
        $('input[type="radio"]').each((_, el) => {
            const $el = $(el);
            
            // Priority for Group Name: 
            // 1. name attribute (standard)
            // 2. Legend of the parent fieldset (PTA Table pattern)
            // 3. Parent container heading
            const name = $el.attr('name') 
                || $el.closest('fieldset').find('legend').text().trim()
                || DomMetadataExtractor._inferGroupNameFromParent($, el);
            
            if (!name) return;

            // Resolve the label (text next to the radio)
            const label = DomMetadataExtractor._resolveLabel($, el)
                || $el.parent().text().trim();
            
            addOption(name, label, DomMetadataExtractor._isConditionallyHidden($, el));
        });

        // ── Angular Material mat-radio-group / mat-radio-button ──────────────
        $('mat-radio-group, mat-selection-list').each((_, el) => {
            const $el = $(el);
            const groupName = fieldId($el) || DomMetadataExtractor._resolveLabel($, el) || 'Selection Group';
            const isHidden  = DomMetadataExtractor._isConditionallyHidden($, el);
            
            $el.find('mat-radio-button, mat-list-option').each((_, btn) => {
                const val = $(btn).text().trim() || $(btn).attr('value') || '';
                if (val) addOption(groupName, val, isHidden);
            });
        });

        // ── ARIA role="radiogroup" / role="radio" ────────────────────────────
        $('[role="radiogroup"]').each((_, el) => {
            const $el = $(el);
            const groupName = $el.attr('aria-label')
                || ($el.attr('aria-labelledby') ? $(`#${$el.attr('aria-labelledby')}`).text().trim() : '')
                || fieldId($el)
                || 'Filter Group';
            
            const isHidden = DomMetadataExtractor._isConditionallyHidden($, el);
            $el.find('[role="radio"], [role="option"], [class*="option"]').each((_, btn) => {
                const val = $(btn).text().trim() || $(btn).attr('aria-label') || '';
                if (val) addOption(groupName, val, isHidden);
            });
        });

        return Object.values(groups)
            .filter(g => g.options.length > 0)
            .map(g => {
                if (!g.conditionallyHidden) delete g.conditionallyHidden;
                return g;
            });
    }

    /**
     * Helper to infer a group name from the parent heading or container.
     * Useful for radio/checkbox filters that don't have explicit 'name' attributes.
     */
    static _inferGroupNameFromParent($, el) {
        const $el = $(el);
        const $parent = $el.closest('div, section, fieldset, [class*="group"], [class*="filter"]');
        if (!$parent.length) return null;

        // Look for a label or heading inside this parent
        const text = $parent.find('label, h3, h4, h5, [class*="label"], [class*="title"]').first().text().trim();
        return text ? text.replace(/\s+/g, '_').toLowerCase() : 'filter_group';
    }

    /**
     * CHECKBOXES — framework-agnostic.
     * Covers: native <input type="checkbox">, Angular Material mat-checkbox,
     * ARIA role="checkbox", custom toggle switches (role="switch").
     */
    static _extractCheckboxes($) {
        const checkboxes = [];
        const seen = new Set();

        const addCheckbox = (el, nameOverride) => {
            const $el = $(el);
            const name  = nameOverride || fieldId($el) || '';
            
            // Fuzzy label resolution for checkboxes:
            // 1. Formal <label>
            // 2. Immediate text sibling
            // 3. Parent container text
            const label = DomMetadataExtractor._resolveLabel($, el) 
                || $el.text().trim() 
                || $el.parent().text().trim() 
                || name;

            const key = `${name}|${label}`;
            if (seen.has(key)) return;
            seen.add(key);

            const entry = { name, label };
            if (DomMetadataExtractor._isConditionallyHidden($, el)) entry.conditionallyHidden = true;
            checkboxes.push(entry);
        };

        // Native + Angular Material
        $('input[type="checkbox"], mat-checkbox').each((_, el) => addCheckbox(el));

        // ARIA checkbox / switch (React, MUI, custom toggle)
        $('[role="checkbox"], [role="switch"]').each((_, el) => {
            const $el = $(el);
            // Skip if it's already a native input wrapped with role
            if ((el.tagName || '').toLowerCase() === 'input') return;
            addCheckbox(el);
        });

        return checkboxes;
    }

    /** BUTTONS */
    static _extractButtons($) {
        const buttons = [];
        const seen = new Set();

        $('button, input[type="submit"], input[type="button"], input[type="reset"], [role="button"]').each((_, el) => {
            const $el = $(el);
            const tag  = (el.tagName || '').toLowerCase();
            const type = $el.attr('type') || (tag === 'button' ? 'button' : 'submit');

            let text = '';
            if (tag === 'input') {
                text = $el.attr('value') || $el.attr('aria-label') || '';
            } else {
                text = $el.text().replace(/\s+/g, ' ').trim()
                    || $el.attr('aria-label')
                    || $el.attr('title')
                    || '';
            }

            if (!text || seen.has(text.toLowerCase())) return;
            seen.add(text.toLowerCase());

            buttons.push({ text, type });
        });

        return buttons;
    }

    /** VALIDATIONS — framework-agnostic (HTML5 + AngularJS + data-* fallbacks) */
    static _extractValidations($) {
        const validations = [];

        $('input, textarea, select').each((_, el) => {
            const $el  = $(el);
            const field = fieldId($el);
            if (!field) return;

            // required — HTML5, AngularJS, ARIA, data-*
            if (hasAttr($el, 'required')
                || $el.attr('ng-required') === 'true'
                || $el.attr('aria-required') === 'true'
                || $el.attr('data-required') === 'true') {
                validations.push({ field, rule: 'required' });
            }

            const maxlength = validationAttr($el, 'maxlength');
            if (maxlength) validations.push({ field, rule: `maxlength:${maxlength}` });

            const minlength = validationAttr($el, 'minlength');
            if (minlength) validations.push({ field, rule: `minlength:${minlength}` });

            const pattern = $el.attr('pattern') || $el.attr('data-pattern');
            if (pattern) validations.push({ field, rule: `pattern:${pattern}` });

            const min = $el.attr('min');
            if (min) validations.push({ field, rule: `min:${min}` });

            const max = $el.attr('max');
            if (max) validations.push({ field, rule: `max:${max}` });

            // Type-implied format rules
            const type = ($el.attr('type') || '').toLowerCase();
            if (type === 'email')  validations.push({ field, rule: 'format:email' });
            if (type === 'number') validations.push({ field, rule: 'format:numeric' });
            if (type === 'tel')    validations.push({ field, rule: 'format:phone' });
            if (type === 'url')    validations.push({ field, rule: 'format:url' });
            if (type === 'date')   validations.push({ field, rule: 'format:date' });
        });

        return validations;
    }

    /**
     * DEPENDENCIES — framework-agnostic.
     * Detects:
     *   A. Parent-child dropdowns (explicit data-* attrs + naming heuristics)
     *   B. Conditional visibility (hidden sections that contain fields)
     *   C. Auto-population ("Same as", "Copy", "Use registered" patterns)
     */
    static _extractDependencies($) {
        const dependencies = [];

        // ── A. Parent-child dropdown dependency ──────────────────────────────
        // Works for any framework — looks at data-* attrs and field naming patterns.
        $('select, mat-select, [role="combobox"]').each((_, el) => {
            const $el = $(el);
            const childName = fieldId($el);
            if (!childName) return;

            // Explicit dependency attributes (any framework can set these)
            const parentAttr = $el.attr('data-parent')
                || $el.attr('data-depends-on')
                || $el.attr('data-parent-field')
                || '';
            if (parentAttr) {
                dependencies.push({ type: 'parent-child', parent: parentAttr, child: childName });
                return;
            }

            // Heuristic: well-known hierarchical naming patterns (language-agnostic)
            // Matches both attribute names (stateId, districtName) and label text (State, District)
            const hierarchies = [
                ['country', 'state'], ['country', 'province'],
                ['state', 'district'], ['state', 'city'],
                ['district', 'taluka'], ['district', 'sub-district'], ['district', 'subdistrict'], ['district', 'block'],
                ['taluka', 'village'], ['taluka', 'gram'], ['sub-district', 'village'],
                ['category', 'subcategory'], ['category', 'subtype'],
                ['type', 'subtype'], ['type', 'subclass'],
                ['pincode', 'city'], ['zip', 'city'],
                ['city', 'area'], ['city', 'locality'],
                ['zone', 'region'], ['region', 'branch'],
                ['department', 'designation'], ['bank', 'branch'],
            ];
            const nameLower = childName.toLowerCase();
            for (const [parent, child] of hierarchies) {
                if (nameLower.includes(child)) {
                    // Look for a parent field anywhere in the same form/section
                    const $scope = $el.closest('form, fieldset, section, article, [data-section]');
                    const $root  = $scope.length ? $scope : $('body');
                    const parentExists = $root.find(
                        `[name*="${parent}"], [id*="${parent}"], [formcontrolname*="${parent}"], [ng-model*="${parent}"], [v-model*="${parent}"]`
                    ).length > 0;
                    if (parentExists) {
                        dependencies.push({ type: 'parent-child', parent, child: childName });
                    }
                }
            }
        });

        // ── B. Conditional visibility ─────────────────────────────────────────
        //
        // TWO strategies — both are needed:
        //
        // Strategy 1 — DOM-present hidden sections (Bootstrap, plain HTML, AngularJS ng-hide)
        //   Find containers that are hidden via CSS/attr and contain form fields.
        //   Works when the section exists in the static DOM but is just not visible.
        //
        // Strategy 2 — Name-based inference (Angular *ngIf, React conditional render)
        //   When a framework removes the section from DOM entirely (Angular *ngIf),
        //   the hidden section is simply absent. Detect the dependency from the
        //   radio/checkbox/select NAME itself using semantic naming patterns like:
        //     isFactoryAddressSame, isSameAddress, hasGuarantor, isGuarantor,
        //     showDetails, enableSection, sameAsRegistered, etc.

        // ── Strategy 1: DOM-present hidden sections ───────────────────────────
        const hiddenSelectors = [
            '[style*="display:none"]',
            '[style*="display: none"]',
            '[style*="visibility:hidden"]',
            '[style*="visibility: hidden"]',
            '[hidden]',
            '[aria-hidden="true"]',
            '.ng-hide',
            '.hidden',
            '.d-none',
            '[class*="is-hidden"]',
            '[class*="is-invisible"]',
            '[class*="collapse"]:not(.show):not(.in)',
        ].join(', ');

        $(hiddenSelectors).each((_, el) => {
            const $el = $(el);
            const fieldSelector = 'input:not([type="hidden"]), select, textarea, mat-select, mat-radio-group, mat-checkbox, [role="combobox"], [role="listbox"], [role="radio"], [role="checkbox"]';
            if ($el.find(fieldSelector).length === 0) return;

            const sectionId    = $el.attr('id') || '';
            const sectionLabel = $el.find('h2, h3, h4, h5, legend, [role="heading"], [class*="section-title"], [class*="panel-title"]')
                .first().text().replace(/\s+/g, ' ').trim();
            const sectionClass = ($el.attr('class') || '')
                .split(' ')
                .filter(c => !['hidden', 'd-none', 'ng-hide', 'collapse', 'is-hidden'].includes(c))
                .join(' ').trim();
            const sectionDesc = sectionLabel || sectionId || sectionClass || 'conditional section';

            const $formScope = $el.closest('form, fieldset, section, article, [data-section]');
            const $root = $formScope.length ? $formScope : $('body');

            const triggerSelector = [
                'input[type="radio"]', 'input[type="checkbox"]',
                'select', 'mat-select', 'mat-radio-group',
                'mat-slide-toggle', '[role="switch"]', '[role="radio"]',
                '[role="checkbox"]', '[role="combobox"]',
            ].join(', ');

            let bestTrigger = null;
            $root.find(triggerSelector).each((_, t) => {
                // eslint-disable-next-line no-bitwise
                const pos = $(t)[0].compareDocumentPosition
                    ? $(t)[0].compareDocumentPosition(el) : 0;
                if (pos & 4) bestTrigger = t;
            });

            let triggerName = '', triggerLabel = '', triggerValue = '';
            if (bestTrigger) {
                const $t = $(bestTrigger);
                triggerName  = fieldId($t) || '';
                triggerLabel = DomMetadataExtractor._resolveLabel($, bestTrigger) || triggerName;
                if (($t.attr('type') || '').toLowerCase() === 'radio') {
                    triggerValue = $t.attr('value') || '';
                }
            }

            const fieldsInside = [];
            $el.find('[name], [id], [formcontrolname], [ng-model], [v-model]').each((_, f) => {
                const fname = fieldId($(f));
                if (fname && !fieldsInside.includes(fname)) fieldsInside.push(fname);
            });

            dependencies.push({
                type:              'conditional-visibility',
                trigger:           triggerName,
                triggerLabel:      triggerLabel,
                triggerValue:      triggerValue || 'specific value',
                controlledSection: sectionDesc,
                fieldsInSection:   fieldsInside.slice(0, 10),
                note:              'Section hidden at page load; appears when trigger condition is met',
            });
        });

        // ── Strategy 2: Name-based inference for *ngIf / conditional render ───
        // When Angular removes a section from DOM entirely, we can only infer the
        // dependency from the controlling field's name. These patterns are universal
        // across Angular, React, and Vue apps.
        //
        // Pattern map: field name fragment → what section it likely controls
        const namePatterns = [
            // "is factory address same" → controls factory address fields
            { pattern: /factoryaddress|isfactoryaddress/i,
              section: 'Factory Address',
              triggerValue: 'No (factory address shown when NOT same as registered)' },
            // "is X same as Y" → controls a duplicate/copy address section
            { pattern: /issame|sameaddress|sameasregistered|sameasabove|copyaddress/i,
              section: 'Address section (same as registered/above)',
              triggerValue: 'Yes' },
            // "is guarantor" → controls guarantor details section
            { pattern: /isguarantor|hasguarantor|guarantorrequired/i,
              section: 'Guarantor Details',
              triggerValue: 'Yes' },
            // "has co-applicant" → controls co-applicant section
            { pattern: /coapplicant|co_applicant|hascoapp/i,
              section: 'Co-Applicant Details',
              triggerValue: 'Yes' },
            // "is NRI" → controls NRI-specific fields
            { pattern: /isnri|nristatus/i,
              section: 'NRI Details',
              triggerValue: 'Yes' },
            // "has collateral" → controls collateral section
            { pattern: /collateral|hascollateral/i,
              section: 'Collateral Details',
              triggerValue: 'Yes' },
            // "show / enable / has / is" prefix patterns — generic
            { pattern: /^(is|has|show|enable|display)[A-Z]/,
              section: 'Conditional section controlled by this field',
              triggerValue: 'Yes / specific value' },
        ];

        // Use mat-radio-group where formcontrolname is set, otherwise fall back to
        // individual radio inputs (deduplicated by name) to catch Angular ngModel bindings.
        const inferredSeen = new Set();

        const checkForNamePattern = (name, el) => {
            if (!name || inferredSeen.has(name)) return;
            for (const { pattern, section, triggerValue } of namePatterns) {
                if (pattern.test(name)) {
                    inferredSeen.add(name);
                    dependencies.push({
                        type:              'conditional-visibility',
                        trigger:           name,
                        triggerLabel:      name,
                        triggerValue,
                        controlledSection: section,
                        fieldsInSection:   [],
                        note:              'Inferred from field name — section rendered conditionally by framework (*ngIf / v-if / conditional render)',
                    });
                    break;
                }
            }
        };

        // Check mat-radio-group with formcontrolname
        $('mat-radio-group').each((_, el) => checkForNamePattern(fieldId($(el)), el));

        // Check individual radio inputs (covers Angular ngModel, plain HTML name attr)
        $('input[type="radio"]').each((_, el) => {
            const name = $(el).attr('name') || $(el).attr('formcontrolname') || $(el).attr('ng-model') || '';
            checkForNamePattern(name, el);
        });

        // Check checkboxes and toggles
        $('input[type="checkbox"], mat-slide-toggle, [role="switch"]').each((_, el) => {
            checkForNamePattern(fieldId($(el)), el);
        });

        // ── C. Auto-population ────────────────────────────────────────────────
        // Checkbox / radio with "same as" / "copy" label text
        $('input[type="checkbox"], input[type="radio"], mat-checkbox, [role="checkbox"]').each((_, el) => {
            const $el = $(el);
            const label = DomMetadataExtractor._resolveLabel($, el) || $el.text().trim() || '';
            if (/same\s+as|copy\s+(from|registered|above)|use\s+(registered|same|profile)/i.test(label)) {
                dependencies.push({
                    type:         'auto-population',
                    trigger:      fieldId($el),
                    triggerLabel: label,
                    description:  `Checking "${label}" auto-fills related fields from another section`,
                });
            }
        });

        // Button with "copy" / "same as" / "fill from" text
        $('button, [role="button"], a[class*="btn"]').each((_, el) => {
            const $el = $(el);
            const text = $el.text().replace(/\s+/g, ' ').trim();
            if (/copy|same\s+as|fill\s+from|use\s+registered|auto.?fill/i.test(text)) {
                const targetSection = $el.attr('data-target')
                    || $el.attr('aria-controls')
                    || $el.attr('href')
                    || '';
                dependencies.push({
                    type:          'auto-population',
                    trigger:       text,
                    targetSection,
                    description:   `Button "${text}" auto-populates fields`,
                });
            }
        });

        // Deduplicate
        const seen = new Set();
        return dependencies.filter(d => {
            const key = JSON.stringify(d);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Returns true if the element (or any ancestor) is currently hidden via any
     * common mechanism across all frameworks.
     *
     * Checks: inline display:none/visibility:hidden, [hidden] attr, aria-hidden="true",
     *         .d-none (Bootstrap), .hidden (Bootstrap 3 / generic), .ng-hide (AngularJS),
     *         .v-show (Vue), .is-hidden (Bulma), .collapse without .show/.in (Bootstrap).
     *
     * Does NOT remove the element — just tags it conditionallyHidden:true so the AI
     * knows it only appears when a trigger condition is activated.
     */
    static _isConditionallyHidden($, el) {
        let current = el;
        while (current && current.tagName) {
            const $c   = $(current);
            const style = ($c.attr('style') || '').replace(/\s/g, '').toLowerCase();
            const cls   = ' ' + ($c.attr('class') || '').toLowerCase() + ' ';

            if (
                style.includes('display:none') ||
                style.includes('visibility:hidden') ||
                hasAttr($c, 'hidden') ||
                $c.attr('aria-hidden') === 'true' ||
                cls.includes(' ng-hide ')       ||  // AngularJS
                cls.includes(' d-none ')        ||  // Bootstrap 4/5
                cls.includes(' is-hidden ')     ||  // Bulma
                cls.includes(' v-show ')        ||  // Vue (when false)
                // Bootstrap collapse: has "collapse" class but NOT "show" or "in"
                (cls.includes(' collapse ') && !cls.includes(' show ') && !cls.includes(' in '))
            ) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    /**
     * Resolves the human-readable label for a form element.
     * Framework-agnostic priority chain:
     *   1. aria-label attribute
     *   2. aria-labelledby → referenced element text
     *   3. <label for="id"> text
     *   4. Wrapping <label> text (with input removed)
     *   5. Angular Material mat-label (inside mat-form-field)
     *   6. Preceding sibling: <label>, <span>, <p>, <dt>, <th>
     *   7. Parent cell text (table-based forms)
     *   8. title attribute
     *   9. placeholder attribute (last resort)
     */
    static _resolveLabel($, el) {
        const $el = $(el);

        // 1. aria-label
        const ariaLabel = $el.attr('aria-label');
        if (ariaLabel) return ariaLabel.trim();

        // 2. aria-labelledby (any framework)
        const labelledBy = $el.attr('aria-labelledby');
        if (labelledBy) {
            // May be a space-separated list of IDs
            const text = labelledBy.split(' ')
                .map(id => $(`#${id}`).text().trim())
                .filter(Boolean)
                .join(' ');
            if (text) return text;
        }

        // 3. <label for="id">
        const id = $el.attr('id');
        if (id) {
            const labelText = $(`label[for="${id}"]`).text().trim();
            if (labelText) return labelText;
        }

        // 4. Wrapping <label>
        const $wrappingLabel = $el.closest('label');
        if ($wrappingLabel.length) {
            const $clone = $wrappingLabel.clone();
            $clone.find('input, select, textarea, mat-select, button').remove();
            const text = $clone.text().replace(/\s+/g, ' ').trim();
            if (text) return text;
        }

        // 5. Angular Material mat-label (inside mat-form-field)
        const $matField = $el.closest('mat-form-field');
        if ($matField.length) {
            const matLabel = $matField.find('mat-label').first().text().trim();
            if (matLabel) return matLabel;
        }

        // 6. Preceding sibling text elements
        const $prev = $el.prevAll('label, span, p, dt, th, legend').first();
        if ($prev.length) {
            const text = $prev.text().replace(/\s+/g, ' ').trim();
            if (text && text.length < 80) return text;
        }

        // 7. Parent table cell (table-based forms: <td> contains label text + input)
        const $td = $el.closest('td');
        if ($td.length) {
            const $prevTd = $td.prev('td, th');
            if ($prevTd.length) {
                const text = $prevTd.text().replace(/\s+/g, ' ').trim();
                if (text && text.length < 80) return text;
            }
        }

        // 8. title attribute
        const title = $el.attr('title');
        if (title) return title.trim();

        // 9. placeholder
        const placeholder = $el.attr('placeholder');
        if (placeholder) return placeholder.trim();

        // 10. Direct Text Node Sibling (Very common in PTA Table)
        const nextSibling = el.nextSibling;
        if (nextSibling && nextSibling.nodeType === 3) { // 3 = Text Node
            const text = $(nextSibling).text().trim();
            if (text) return text;
        }

        return '';
    }

    /** Returns an empty result structure */
    static _emptyResult() {
        return {
            pageInfo:     { pageTitle: '', moduleName: 'Application Form', headings: [] },
            inputs:       [],
            dropdowns:    [],
            radioGroups:  [],
            checkboxes:   [],
            buttons:      [],
            validations:  [],
            dependencies: [],
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // METADATA OPTIMIZATION (integrated from MetadataOptimizer)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Optimize metadata to reduce token usage
     * - Removes Angular-specific ID properties (mat-input-*, mat-select-*, mat-radio-group-*)
     * - Keeps fields with semantic names, removes fields with ONLY Angular IDs
     * - Detects repetitive field patterns (Partner 1, Partner 2, etc.)
     * - Compresses repetitive sections using pattern + count
     * - Groups validations by field
     */
    static _optimizeMetadata(metadata) {
        const optimized = {
            pageInfo: metadata.pageInfo,
            inputs: [],
            dropdowns: [],
            radioGroups: [],
            checkboxes: metadata.checkboxes || [],
            buttons: metadata.buttons || [],
            validations: DomMetadataExtractor._groupValidations(metadata.validations || []),
            dependencies: metadata.dependencies || []
        };

        // Clean Angular IDs from inputs
        const cleanedInputs = DomMetadataExtractor._cleanAngularIds(metadata.inputs || []);

        // Clean Angular IDs from dropdowns
        optimized.dropdowns = DomMetadataExtractor._cleanAngularFieldNames(metadata.dropdowns || [], 'fieldName');

        // Clean Angular IDs from radio groups
        optimized.radioGroups = DomMetadataExtractor._cleanAngularFieldNames(metadata.radioGroups || [], 'fieldName');

        // Detect and compress repetitive patterns
        const { cleanedInputs: finalInputs, patterns } = DomMetadataExtractor._detectRepetitivePatterns(cleanedInputs);
        
        optimized.inputs = finalInputs;
        
        if (patterns.length > 0) {
            optimized.repetitivePatterns = patterns;
            console.log(`-> [DomMetadataExtractor] Detected ${patterns.length} repetitive patterns`);
        }

        return optimized;
    }

    /**
     * Clean Angular-generated IDs from inputs
     * - Remove 'id' property if it's mat-input-*, mat-select-*, etc.
     * - Derive semantic name from label if name is mat-input-*
     * - Remove entire field if name is ONLY mat-input-* AND no useful label
     */
    static _cleanAngularIds(inputs) {
        const angularIdPattern = /^(mat-input-|mat-select-|mat-radio-|mat-checkbox-|input-|field-)\d+$/;
        
        return inputs
            .filter(input => {
                // Keep field if name is semantic (not Angular-generated)
                if (!angularIdPattern.test(input.name)) {
                    return true;
                }
                
                // Remove field if ONLY has Angular ID and no useful label
                if (!input.label || input.label.length < 2) {
                    return false;
                }
                
                // Keep field if it has a useful label (we'll derive name from it)
                return true;
            })
            .map(input => {
                const cleaned = { ...input };
                
                // Remove 'id' property if it's Angular-generated
                if (cleaned.id && angularIdPattern.test(cleaned.id)) {
                    delete cleaned.id;
                }
                
                // Derive semantic name from label if name is Angular-generated
                if (angularIdPattern.test(cleaned.name) && cleaned.label) {
                    cleaned.name = DomMetadataExtractor._deriveNameFromLabel(cleaned.label);
                }
                
                return cleaned;
            });
    }

    /**
     * Clean Angular-generated field names from dropdowns/radio groups
     * - Remove fields with mat-radio-group-*, mat-select-* names and no useful options
     * - Remove fields with ONLY generic options (Option 1, Option 2, etc.)
     * - Derive semantic name from first non-generic option if fieldName is Angular-generated
     * - Keep dropdowns even if options are empty (might be loaded dynamically)
     */
    static _cleanAngularFieldNames(fields, nameProperty = 'fieldName') {
        const angularIdPattern = /^(mat-radio-group-|mat-select-|mat-input-)\d+$/;
        const genericPattern = /^(unknown|field|input|select|radio)$/i;
        const genericOptionPattern = /^Option\s+\d+$/i;
        
        return fields
            .filter(field => {
                const fieldName = field[nameProperty];
                const hasOptions = field.options && field.options.length > 0;
                
                // Check if ALL options are generic
                const allOptionsGeneric = hasOptions &&
                    field.options.every(opt => genericOptionPattern.test(opt));
                
                if (allOptionsGeneric) {
                    return false; // Remove fields with ONLY generic options
                }
                
                // Keep field if name is semantic
                if (!angularIdPattern.test(fieldName) && !genericPattern.test(fieldName)) {
                    return true;
                }
                
                // Remove if Angular ID and no options at all
                if (!hasOptions) {
                    return false;
                }
                
                // Keep field if it has useful options (at least one non-generic)
                return true;
            })
            .map(field => {
                const cleaned = { ...field };
                const fieldName = cleaned[nameProperty];
                const hasOptions = cleaned.options && cleaned.options.length > 0;
                
                // Derive semantic name if fieldName is Angular-generated or generic
                if ((angularIdPattern.test(fieldName) || genericPattern.test(fieldName)) && hasOptions) {
                    // Find first non-generic option
                    const firstNonGenericOption = cleaned.options.find(opt => !genericOptionPattern.test(opt));
                    
                    if (firstNonGenericOption) {
                        cleaned[nameProperty] = DomMetadataExtractor._deriveNameFromLabel(firstNonGenericOption + ' Selection');
                    }
                }
                
                // Remove generic options from the options array
                if (cleaned.options && cleaned.options.length > 0) {
                    const filteredOptions = cleaned.options.filter(opt => !genericOptionPattern.test(opt));
                    // Only update if we have non-generic options
                    if (filteredOptions.length > 0) {
                        cleaned.options = filteredOptions;
                    }
                }
                
                return cleaned;
            });
    }

    /**
     * Derive semantic field name from label
     * Example: "Enter your full name" → "enterYourFullName"
     */
    static _deriveNameFromLabel(label) {
        if (!label) return 'unknown';
        
        return label
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '') // Remove special chars
            .trim()
            .split(/\s+/)                // Split by spaces
            .filter(word => word.length > 0)
            .map((word, idx) => {
                // camelCase: first word lowercase, rest capitalized
                if (idx === 0) return word;
                return word.charAt(0).toUpperCase() + word.slice(1);
            })
            .join('')
            .substring(0, 50); // Limit length
    }

    /**
     * Detect repetitive patterns (Partner 1, Partner 2, Director 1, Director 2, etc.)
     */
    static _detectRepetitivePatterns(inputs) {
        const patterns = [];
        const fieldGroups = {};
        
        // Group fields by base name (without numeric suffix)
        inputs.forEach(input => {
            const match = input.name.match(/^(.+?)(\d+)$/);
            if (match) {
                const baseName = match[1];
                const index = parseInt(match[2]);
                
                if (!fieldGroups[baseName]) {
                    fieldGroups[baseName] = [];
                }
                fieldGroups[baseName].push({ ...input, index });
            }
        });

        // Find groups with 2+ instances
        const cleanedInputs = [...inputs];
        
        Object.entries(fieldGroups).forEach(([baseName, fields]) => {
            if (fields.length >= 2) {
                // Check if fields have same structure
                const firstField = fields[0];
                const allSame = fields.every(f => 
                    f.type === firstField.type &&
                    f.required === firstField.required &&
                    f.minlength === firstField.minlength &&
                    f.maxlength === firstField.maxlength
                );

                if (allSame) {
                    patterns.push({
                        baseName,
                        count: fields.length,
                        pattern: {
                            name: `${baseName}[N]`,
                            type: firstField.type,
                            required: firstField.required,
                            label: firstField.label?.replace(/\d+/, '[N]'),
                            minlength: firstField.minlength,
                            maxlength: firstField.maxlength,
                            pattern: firstField.pattern
                        },
                        description: `This field repeats ${fields.length} times (${baseName}0, ${baseName}1, ..., ${baseName}${fields.length - 1})`
                    });

                    // Remove individual fields from inputs (they're now in pattern)
                    fields.forEach(f => {
                        const idx = cleanedInputs.findIndex(input => input.name === f.name);
                        if (idx !== -1) {
                            cleanedInputs.splice(idx, 1);
                        }
                    });
                }
            }
        });

        return { cleanedInputs, patterns };
    }

    /**
     * Group validations by field
     */
    static _groupValidations(validations) {
        const grouped = {};
        
        validations.forEach(v => {
            const field = v.field;
            if (!grouped[field]) {
                grouped[field] = [];
            }
            grouped[field].push(v.rule);
        });

        return Object.entries(grouped).map(([field, rules]) => ({
            field,
            rules
        }));
    }
}

module.exports = DomMetadataExtractor;
