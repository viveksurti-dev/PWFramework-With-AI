'use strict';

/**
 * JourneyToPlaywright.js
 *
 * Pure JS (zero AI) converter.
 * Reads the recorded journey from a per-session journey file or queue_status.json,
 * then writes THREE files automatically:
 *   pages/<FlowName>Page.js              — Page Object, one method per page
 *   verification/<FlowName>Verif.js      — Verification class, one verifyXxx() per page
 *   tests/<FlowName>_recorded.spec.js    — Playwright test that calls both
 *
 * Usage (standalone):
 *   node utils/AIUtility/services/JourneyToPlaywright.js <safeName>
 *
 * Usage (programmatic):
 *   const j2p = require('./JourneyToPlaywright');
 *   await j2p.generate(safeName);
 */

const fs   = require('fs');
const path = require('path');
const fileService = require('./FileHandler');

// ─── Selector priority ────────────────────────────────────────────────────────
// Consumes the ranked multi-strategy locator structure produced by Recorder.js.
// Priority order:
//   1. Playwright role/testId/label/placeholder (most resilient)
//   2. data-testid CSS
//   3. aria-label CSS
//   4. text-based XPath (for buttons/links)
//   5. placeholder / name / stable-id CSS (for inputs)
//   6. structural CSS (short, non-positional)
//   7. structural XPath (last resort)
//
// Auto-generated IDs (ending in digits, or framework prefixes) are always skipped.
function bestSelector(locators = {}, fallback = '') {
    const tag      = (locators.tagName || '').toLowerCase();
    const isInput  = tag === 'input' || tag === 'textarea' || tag === 'select';
    const isButton = tag === 'button' || tag === 'a' || tag === 'summary';

    // ── Auto-ID guard (framework-agnostic) ───────────────────────────────────
    const isAutoId = (id) => !id || /[-_]\d+$/.test(id) || /^(mat-|ng-|cdk-|rc-|mdc-|v-|vue-|ember|__)/i.test(id);

    // ── 1. Playwright ranked array — best-first ───────────────────────────────
    // Use the first entry from the playwright[] array captured by the recorder.
    // These are already ordered: getByTestId > getByRole > getByPlaceholder > getByLabel > getByText
    const pwList = locators.playwright || [];
    if (pwList.length > 0) {
        // Wrap in page.locator() call format for use in clickElement/fillInput
        // getByTestId/getByRole etc. are returned as-is — the code gen wraps them
        // For JourneyToPlaywright we need a string selector, so convert:
        //   getByRole('button', { name: 'Submit' }) → [role="button"][name="Submit"] is wrong
        // Instead, prefer the CSS/aria equivalents for string-based selectors,
        // and only fall through to playwright[] for the AI prompt context.
        // For string selectors: testId > aria-label > placeholder > text XPath
    }

    // ── 2. data-testid — most stable attribute ────────────────────────────────
    if (locators.testId) return `[data-testid="${locators.testId}"]`;

    // ── 3. aria-label ─────────────────────────────────────────────────────────
    if (locators.ariaLabel) return `[aria-label="${locators.ariaLabel}"]`;

    // ── 4. For inputs: placeholder > name > stable id ─────────────────────────
    if (isInput) {
        if (locators.placeholder) return `[placeholder="${locators.placeholder}"]`;
        if (locators.name)        return `[name="${locators.name}"]`;
        if (locators.id && !isAutoId(locators.id)) return `#${locators.id}`;
    }

    // ── 5. For buttons/links: text-based XPath ────────────────────────────────
    if (isButton) {
        // Prefer text[] array first (already has xpath= prefix)
        const textList = locators.textList || [];
        if (textList.length > 0) return textList[0];
        // textXPath is a bare expression — add prefix only if missing
        if (locators.textXPath) {
            return locators.textXPath.startsWith('xpath=')
                ? locators.textXPath
                : `xpath=${locators.textXPath}`;
        }
        // Build from innerText
        const text = (locators.innerText || '').trim();
        if (text && text.length <= 60) {
            const safeText = text.replace(/'/g, "\\'");
            return `xpath=//${tag}[normalize-space()='${safeText}']`;
        }
    }

    // ── 6. Stable ID ──────────────────────────────────────────────────────────
    if (locators.id && !isAutoId(locators.id)) return `#${locators.id}`;

    // ── 7. Text XPath for any element with short stable text ─────────────────
    const textList = locators.textList || [];
    if (textList.length > 0) return textList[0]; // already has xpath= prefix
    // textXPath is stored as a bare expression — add prefix
    if (locators.textXPath && !locators.textXPath.startsWith('xpath=')) return `xpath=${locators.textXPath}`;
    if (locators.textXPath) return locators.textXPath; // already prefixed

    // ── 8. Name attribute ─────────────────────────────────────────────────────
    if (locators.name) return `[name="${locators.name}"]`;

    // ── 9. CSS from ranked array — short, non-positional only ─────────────────
    const cssList = locators.cssList || [];
    for (const c of cssList) {
        const isPositional = c.includes(':nth-of-type') || c.includes(':nth-child') || c.split('>').length > 3;
        if (!isPositional) return c;
    }

    // ── 10. Legacy cssSelector fallback ──────────────────────────────────────
    const css = locators.cssSelector || '';
    const isPositional = css.includes(':nth-of-type') || css.includes(':nth-child') || css.split('>').length > 3;
    if (css && !isPositional) return css;

    // ── 11. XPath from ranked array — last resort ─────────────────────────────
    const xpathList = locators.xpathList || [];
    if (xpathList.length > 0) return xpathList[0]; // already has xpath= prefix
    // locators.xpath is a bare expression (no prefix) — add it
    if (locators.xpath && !locators.xpath.startsWith('xpath=')) return `xpath=${locators.xpath}`;
    if (locators.xpath) return locators.xpath; // already prefixed

    return fallback;
}

// ─── Build XPath-safe selector string ────────────────────────────────────────
// Accepts a raw selector from bestSelector() — which may or may not already
// carry the "xpath=" prefix — and returns a JS string literal safe to embed
// in generated code.
//
// Handles:
//   "xpath=//button[...]"          → 'xpath=//button[...]'
//   "//button[...]"                → 'xpath=//button[...]'
//   "[placeholder='x']"            → '[placeholder=\'x\']'
//   XPath with apostrophes         → uses concat() to avoid invalid XPath
function safeXPathSelector(rawSelector) {
    if (!rawSelector) return "''";

    // Strip newlines/carriage returns — multiline innerText breaks string literals
    rawSelector = rawSelector.replace(/\r?\n|\r/g, ' ').trim();

    // ── Normalise: collapse any duplicate xpath= prefixes ─────────────────────
    // e.g. "xpath=xpath=//..." → "xpath=//..."
    while (rawSelector.startsWith('xpath=xpath=')) {
        rawSelector = 'xpath=' + rawSelector.slice('xpath=xpath='.length);
    }

    // ── Non-XPath selector (CSS, attribute, etc.) ─────────────────────────────
    if (!rawSelector.startsWith('xpath=')) {
        // If it looks like a bare XPath (starts with // or (//) add the prefix
        if (rawSelector.startsWith('//') || rawSelector.startsWith('(//')) {
            rawSelector = 'xpath=' + rawSelector;
        } else {
            return `'${esc(rawSelector)}'`;
        }
    }

    const xpathExpr = rawSelector.slice(6); // strip "xpath="

    // No apostrophes in the expression — safe to use single-quoted JS string
    if (!xpathExpr.includes("'")) {
        return `'xpath=${esc(xpathExpr)}'`;
    }

    // Replace quoted text containing apostrophes → XPath concat()
    const fixed = xpathExpr
        .replace(
            /normalize-space\(\)='([^']+)'/g,
            (match, text) => {
                if (!text.includes("'")) return match;
                const parts = text.split("'").map(p => `'${p}'`).join(`, "'"`, );
                return `normalize-space()=concat(${parts})`;
            }
        )
        .replace(
            /contains\(text\(\),'([^']+)'\)/g,
            (match, text) => {
                if (!text.includes("'")) return match;
                const parts = text.split("'").map(p => `'${p}'`).join(`, "'"`, );
                return `contains(text(),concat(${parts}))`;
            }
        );

    // Use double-quoted JS string to avoid escaping issues
    return `"xpath=${fixed.replace(/"/g, '\\"')}"`;
}

// ─── Escape a string for use inside a JS single-quoted string ─────────────────
function esc(str) {
    if (str == null) return '';
    // Strip newlines and carriage returns — multiline innerText breaks string literals
    return String(str)
        .replace(/\r?\n|\r/g, ' ')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
}

// ─── Convert a URL to a safe PascalCase method name ───────────────────────────
function urlToMethodName(url) {
    try {
        const u = new URL(url);
        const parts = (u.pathname + u.search)
            .replace(/[^a-zA-Z0-9/]/g, '_')
            .split('/')
            .filter(Boolean);
        if (parts.length === 0) return 'homePage';
        // Take last 2 meaningful segments
        const seg = parts.slice(-2).join('_');
        // PascalCase first letter
        return seg.charAt(0).toLowerCase() + seg.slice(1);
    } catch {
        return 'page';
    }
}

// ─── Detect if a selector/placeholder looks like a captcha field ──────────────
function isCaptchaField(locators = {}, value = '') {
    const hints = [
        locators.placeholder, locators.ariaLabel, locators.innerText, value
    ].map(v => (v || '').toLowerCase());
    return hints.some(h => h.includes('captcha') || h.includes('verification code'));
}

// ─── Detect if the element is a <select> ─────────────────────────────────────
function isSelectElement(locators = {}) {
    return (locators.tagName || '').toLowerCase() === 'select';
}

// ─── Build one Playwright statement for a single action ──────────────────────
// Returns { line: string, isAsync: boolean }
// testDataMap: object to collect { key: value } pairs for test-data JSON
function actionToStatement(action, indent = '        ', testDataMap = {}) {
    const sel  = bestSelector(action.locators, action.selector || '');
    const val  = action.value;
    const loc  = action.locators || {};

    if (action.type === 'input') {
        if (!sel || !val) return null;

        // Captcha — pause for manual solve, then continue
        if (isCaptchaField(loc, val)) {
            return {
                line: `${indent}// Captcha detected — fill manually in the browser, then click Resume\n` +
                      `${indent}await this.page.pause();`,
                isAsync: true
            };
        }

        // Select element
        if (isSelectElement(loc)) {
            // Store in test data
            const key = toDataKey(sel, 'select');
            testDataMap[key] = val;
            return {
                line: `${indent}await this.page.selectOption(${safeXPathSelector(sel)}, testData['${key}']);`,
                isAsync: true
            };
        }

        // Checkbox / radio — already handled by click
        const tag = (loc.tagName || '').toLowerCase();
        const inputType = (loc.cssSelector || '').includes('checkbox') || sel.includes('checkbox')
            ? 'checkbox'
            : (loc.cssSelector || '').includes('radio') || sel.includes('radio')
            ? 'radio'
            : '';
        if (tag === 'input' && (inputType === 'checkbox' || inputType === 'radio')) {
            return null;
        }

        // File input — skip
        if ((loc.placeholder || '').includes('fakepath') || (val || '').includes('fakepath') || (val || '').includes('C:\\')) {
            return {
                line: `${indent}// TODO: file upload — set input file path manually\n` +
                      `${indent}// await this.page.setInputFiles(${safeXPathSelector(sel)}, '/path/to/file');`,
                isAsync: false
            };
        }

        // Hidden/submit inputs — skip noise
        if ((loc.cssSelector || '').includes('fieldset') && (val === 'Login' || val === 'Submit')) {
            return null;
        }

        // Store value in test data map, use key reference in code
        const key = toDataKey(sel, loc.placeholder || loc.ariaLabel || '');
        testDataMap[key] = val;

        return {
            line: `${indent}await this.fillInput(${safeXPathSelector(sel)}, testData['${key}']);\n` +
                  `${indent}await expect(this.page.locator(${safeXPathSelector(sel)})).toHaveValue(testData['${key}']);`,
            isAsync: true
        };
    }

    if (action.type === 'click') {
        // Skip only true noise: bare html/body/window elements
        if (!sel || sel === 'html' || sel === 'body' || sel === 'window') return null;

        const tag       = (loc.tagName || '').toLowerCase();
        const css       = loc.cssSelector || '';
        const innerText = (loc.innerText || '').trim().toLowerCase();

        // Skip label clicks ONLY when they wrap a plain input (redundant — fillInput handles it)
        if (tag === 'label' && !sel.includes('radio') && !sel.includes('checkbox')) return null;

        // Skip div/span clicks that are just floating labels or field wrappers —
        // these resolve to invisible wrapper elements, not the actual input.
        // A div/span with text that matches a field label is always noise.
        // Real clickable divs (tabs, cards, buttons) have roles or are interactive.
        if (tag === 'div' || tag === 'span') {
            const role = (loc.ariaLabel || '').toLowerCase();
            const hasInteractiveRole = role.includes('button') || role.includes('tab') ||
                                       role.includes('link')   || role.includes('menu');
            const looksLikeFieldLabel = innerText.length > 0 && innerText.length < 60 &&
                                        !hasInteractiveRole &&
                                        !css.includes('card') && !css.includes('tab') &&
                                        !css.includes('btn')  && !css.includes('button');
            // If the same text appears as a placeholder or aria-label of an input in this page's actions,
            // it's definitely a floating label — skip it
            const allActions = action._allActions || [];
            const isFloatingLabel = looksLikeFieldLabel && allActions.some(a => {
                const aLoc = a.locators || {};
                return (aLoc.placeholder || '').toLowerCase() === innerText ||
                       (aLoc.ariaLabel  || '').toLowerCase() === innerText;
            });
            if (isFloatingLabel) return null;
        }

        // ── Generic modal/dialog detection ───────────────────────────────────
        // Works for: Angular Material (mat-dialog), Bootstrap (modal), native dialog,
        // custom overlays (role=dialog), and any element with "dialog" in its CSS class/id
        const isInsideDialog = (
            css.includes('dialog') ||          // mat-dialog, modal-dialog, dialog-actions, etc.
            css.includes('modal') ||           // Bootstrap modal, custom modals
            css.includes('overlay') ||         // cdk-overlay, custom overlays
            css.includes('popup') ||           // custom popups
            css.includes('drawer')             // side drawers that require scroll
        );

        // Skip backdrop/overlay close clicks (clicking outside the modal to dismiss)
        const isBackdropClick = (
            (css.includes('overlay') || css.includes('backdrop')) &&
            (tag === 'div' || tag === 'section' || tag === 'aside')
        );
        if (isBackdropClick) return null;

        // Skip dismiss/cancel buttons inside any dialog/modal
        const isDismissButton = isInsideDialog && (
            innerText === 'close'   ||
            innerText === 'cancel'  ||
            innerText === 'dismiss' ||
            innerText === 'no'      ||
            innerText === '×'       ||
            innerText === 'x'
        );
        if (isDismissButton) return null;

        // For proceed/accept buttons inside any dialog that requires scroll-to-bottom
        // before the button becomes enabled (consent modals, T&C dialogs, etc.)
        const isProceedInDialog = isInsideDialog && (
            innerText === 'next'             ||
            innerText === 'agree & proceed'  ||
            innerText === 'agree'            ||
            innerText === 'proceed'          ||
            innerText === 'accept'           ||
            innerText === 'confirm'          ||
            innerText === 'ok'               ||
            innerText === 'continue'         ||
            innerText === 'submit'
        );
        if (isProceedInDialog) {
            return {
                // Scroll the first scrollable container inside any dialog/modal to bottom,
                // then click. Works for mat-dialog-content, .modal-body, [role=dialog], etc.
                line: `${indent}// Scroll modal/dialog content to bottom to enable the button\n` +
                      `${indent}await this.page.evaluate(() => {\n` +
                      `${indent}    const dialog = document.querySelector('[role="dialog"], .modal, mat-dialog-container, .popup, .drawer, [class*="dialog"], [class*="modal"]');\n` +
                      `${indent}    const scrollable = dialog ? (dialog.querySelector('[class*="content"], [class*="body"], [class*="scroll"]') || dialog) : document.documentElement;\n` +
                      `${indent}    scrollable.scrollTop = scrollable.scrollHeight;\n` +
                      `${indent}});\n` +
                      `${indent}await this.page.waitForTimeout(300);\n` +
                      `${indent}await this.clickElement(${safeXPathSelector(sel)});`,
                isAsync: true
            };
        }

        // For input/textarea: skip focus-before-typing clicks
        if (tag === 'input' || tag === 'textarea') {
            const isCheckbox  = sel.includes('checkbox') || css.includes('checkbox');
            const isRadio     = sel.includes('radio')    || css.includes('radio');
            const isFileInput = (loc.name || '') === 'browsefile' || css.includes('file');

            if (!isCheckbox && !isRadio && !isFileInput) {
                const allActions = action._allActions || [];
                const hasFill = allActions.some(a => a.type === 'input' && bestSelector(a.locators, a.selector) === sel);
                if (hasFill) return null;
            }
        }

        // Skip body > div overlay backdrop clicks
        if (css.match(/^body\s*>\s*div/) && tag === 'div' && !innerText) return null;

        return {
            line: `${indent}await this.clickElement(${safeXPathSelector(sel)});`,
            isAsync: true
        };
    }

    if (action.type === 'scroll') {
        // Skip page-level scrolls — Playwright auto-scrolls to elements before interacting.
        // Dialog-level scrolls are handled above in the dialog proceed button logic.
        return null;
    }

    if (action.type === 'hashchange') {
        return {
            line: `${indent}// hash changed to: ${esc(val)}`,
            isAsync: false
        };
    }

    return null;
}

// ─── Deduplicate actions: for inputs keep only the LAST value per selector ────
function deduplicateActions(actions) {
    const result = [];
    // Walk forward; for input actions, if a later input on same selector exists, skip this one
    for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        if (a.type === 'input') {
            // Find if there's a later input on the same selector
            const laterIdx = actions.findIndex((b, j) => j > i && b.type === 'input' && b.selector === a.selector);
            if (laterIdx !== -1) continue; // skip — later value will be used
        }
        result.push(a);
    }
    return result;
}

// ─── Main generator ───────────────────────────────────────────────────────────
async function generate(safeName) {
    // 1. Load journey — prefer per-session file, fall back to shared queue
    const sessionPath = path.join(fileService.queueDir, `${safeName}_journey.json`);
    const queuePath   = path.join(fileService.queueDir, 'queue_status.json');

    let journey = [];

    if (fs.existsSync(sessionPath)) {
        // Per-session file exists — use it (isolated, correct)
        const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
        journey = session.journey || [];
        console.log(`-> [J2P] Loaded session journey: ${sessionPath} (${journey.length} steps)`);

    } else if (fs.existsSync(queuePath)) {
        // Fall back to shared queue (legacy / single-session use)
        const session = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
        journey = session.journey || [];
        console.log(`-> [J2P] No session file found for '${safeName}'. Using shared queue_status.json (${journey.length} steps)`);
        console.log(`-> [J2P] TIP: Run a new recording session to get an isolated journey file.`);

    } else {
        // Show available sessions to help the user pick the right safeName
        const available = fs.existsSync(fileService.queueDir)
            ? fs.readdirSync(fileService.queueDir)
                .filter(f => f.endsWith('_journey.json'))
                .map(f => f.replace('_journey.json', ''))
            : [];

        const hint = available.length > 0
            ? `\nAvailable sessions:\n${available.map(s => `  - ${s}`).join('\n')}`
            : '\nNo recorded sessions found. Record a session first (Option 1 in E2E mode).';

        throw new Error(`No journey found for safeName: '${safeName}'${hint}`);
    }

    if (journey.length === 0) {
        throw new Error('Journey is empty. Please record a session first.');
    }

    // 2. Determine flow name + start URL
    const firstUrlEntry = journey.find(s => s.url);
    const startUrl      = firstUrlEntry ? firstUrlEntry.url : '';

    // Derive a clean flowName from the starting URL, not from the safeName argument
    // e.g. https://qa-sidbi-earth.instantmseloans.in/home/sidbimsmedigi
    //   → QaSidbiEarthInstantmseloansInHomeSidbimsmedigi
    let urlDerivedName = safeName;
    if (startUrl) {
        try {
            const u = new URL(startUrl);
            urlDerivedName = (u.hostname + u.pathname)
                .replace(/[^a-zA-Z0-9]/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '')
                .substring(0, 40);
        } catch { /* keep safeName */ }
    }

    const flowName  = toPascalCase(urlDerivedName);
    const pageClass = `${flowName}Page`;
    const testName  = `${flowName}_recorded`;

    console.log(`\n-> [J2P] Flow: ${flowName} | Start: ${startUrl} | Steps: ${journey.length}`);

    // 3. Group actions by URL (preserve order of first appearance)
    const pageOrder = [];   // ordered list of unique URLs
    const pageActions = {}; // url → [actions]

    for (const step of journey) {
        if (!step.url) continue;
        const url = step.url;

        if (!pageActions[url]) {
            pageActions[url] = [];
            pageOrder.push(url);
        }

        // Only keep actual user actions (type field present)
        if (step.type) {
            pageActions[url].push(step);
        }
    }

    // 4. Build page class methods — one per URL
    // Also collect all input values to save as test data
    const methodDefs   = [];
    const methodCalls  = [];
    const isFirstPage  = (url) => url === pageOrder[0];
    const testDataMap  = {}; // key → value, collected from all input actions

    for (const url of pageOrder) {
        const actions = deduplicateActions(pageActions[url] || []);
        const methodName = urlToMethodName(url);

        const bodyLines = [];

        // Only the FIRST page needs navigateToUrl — all others arrive via E2E flow navigation
        if (isFirstPage(url)) {
            bodyLines.push(`        await this.navigateToUrl('${esc(url)}');`);
            bodyLines.push(`        await this.page.waitForLoadState('domcontentloaded');`);
        } else {
            bodyLines.push(`        await this.page.waitForLoadState('domcontentloaded');`);
        }

        for (const action of actions) {
            action._allActions = actions;
            const stmt = actionToStatement(action, '        ', testDataMap);
            if (!stmt) continue;
            bodyLines.push(stmt.line);
        }

        // waitForURL to confirm navigation to next page
        const nextUrl = pageOrder[pageOrder.indexOf(url) + 1];
        if (nextUrl && nextUrl !== url) {
            try {
                const nextPath = new URL(nextUrl).pathname;
                bodyLines.push(`        await this.page.waitForURL('**${nextPath}', { timeout: 30000 });`);
            } catch { /* ignore */ }
        }

        const methodSrc =
`    /**
     * Actions performed on: ${url}
     */
    async ${methodName}() {
${bodyLines.join('\n')}
    }`;

        methodDefs.push(methodSrc);
        methodCalls.push({ methodName, url });
    }

    // 5. Save test data JSON file
    const dataFileName = `${flowName}_data.json`;
    const dataFilePath = path.join(fileService.dataDir, dataFileName);
    fileService._atomicWrite(dataFilePath, JSON.stringify(testDataMap, null, 2));
    console.log(`-> [J2P] ✅ Test data   : ${dataFilePath}`);

    // 6. Assemble page class file — loads test data from JSON at runtime
    const escapedDataPath = dataFilePath.replace(/\\/g, '\\\\');
    const pageFileSrc =
`import { expect } from '@playwright/test';
import { CommonMethods } from './CommonMethods.js';
import { readFileSync } from 'fs';
const testData = JSON.parse(readFileSync('${escapedDataPath}', 'utf8'));

export class ${pageClass} extends CommonMethods {
    constructor(page) {
        super(page);
    }

${methodDefs.join('\n\n')}
}
`;

    // 7. Assemble test spec
    const escapedDataPathForSpec = dataFilePath.replace(/\\/g, '\\\\');
    const testCallLines = methodCalls.map(({ methodName: mName, url }) =>
        `        await pageObj.${mName}(); // ${url}`
    ).join('\n');

    const testFileSrc =
`import { test, expect } from '@playwright/test';
import { ${pageClass} } from '../pages/${pageClass}.js';
import { readFileSync } from 'fs';

// Test data loaded from: ${escapedDataPathForSpec}
// Edit that file to change input values without touching this script.
const testData = JSON.parse(readFileSync('${escapedDataPathForSpec}', 'utf8'));

test.describe('${flowName} — Recorded Journey', () => {

    test.beforeAll(() => {
        console.log('\\n-> [Test Data] Loaded ${Object.keys(testDataMap).length} field(s):');
        Object.entries(testData).forEach(([k, v]) => console.log(\`   \${k}: \${v}\`));
    });

    test('TC-REC-1: Full happy path recorded flow', async ({ page }) => {
        const pageObj = new ${pageClass}(page);

${testCallLines}
    });

});
`;

    // 7. Write both files atomically
    const pageFilePath = path.join(fileService.pagesDir, `${pageClass}.js`);
    const testFilePath = path.join(fileService.testsDir, `${testName}.spec.js`);

    const atomicWrite = (filePath, content) => {
        const tmp = filePath + '.tmp_' + process.pid;
        fs.writeFileSync(tmp, content, 'utf8');
        fs.renameSync(tmp, filePath);
    };

    atomicWrite(pageFilePath, pageFileSrc);
    atomicWrite(testFilePath, testFileSrc);

    console.log(`-> [J2P] ✅ Page class : ${pageFilePath}`);
    console.log(`-> [J2P] ✅ Test spec  : ${testFilePath}`);
    console.log(`-> [J2P] Done. Run with: npx playwright test "${testFilePath}"`);

    return { pageFilePath, testFilePath };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toPascalCase(str) {
    return str
        .split(/[_\s-]+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('');
}

// Convert a selector + hint into a clean camelCase data key
// e.g. '[placeholder="Enter Email Id"]' → 'enterEmailId'
function toDataKey(selector, hint = '') {
    const src = hint || selector;
    return src
        .replace(/[\[\]"'@=.*\/\\#]/g, ' ')
        .replace(/placeholder|aria-label|name/gi, '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((w, i) => i === 0
            ? w.charAt(0).toLowerCase() + w.slice(1)
            : w.charAt(0).toUpperCase() + w.slice(1))
        .join('')
        .replace(/[^a-zA-Z0-9]/g, '')
        || `field_${Math.random().toString(36).slice(2, 6)}`;
}

module.exports = { generate };

// ─── Standalone CLI ───────────────────────────────────────────────────────────
if (require.main === module) {
    const safeName = process.argv[2];
    if (!safeName) {
        console.error('Usage: node JourneyToPlaywright.js <safeName>');
        process.exit(1);
    }
    generate(safeName).catch(err => {
        console.error('-> [J2P] Error:', err.message);
        process.exit(1);
    });
}
