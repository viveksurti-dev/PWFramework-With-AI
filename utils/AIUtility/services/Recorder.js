const fileService = require("./FileHandler");
const http = require("http");
const config = require("../config/UtilityConfig");

const SPY_PORT = config.recording.spyPort;

class Recorder {
    constructor() {
        this.actionQueue = [];
        this.sessionData = {};
        this.isRecording = false;
        this.lastActivityTime = Date.now();
        this._server = null;
        this._actionHandler = null;
        this._activePage = null;        // set by injectSpy — used for mid-interaction DOM snapshots
        this._domSnapshotTimer = null;  // debounce timer for DOM capture on input/click
    }

    /**
     * Starts a local HTTP server that receives actions from the browser via fetch()
     * This approach works across ALL navigations, origins, and page reloads
     */
    async startActionServer(urlSafeName) {
        if (this._server) return; // Already running

        this._server = http.createServer((req, res) => {
            // CORS headers so the browser can POST from any origin
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            if (req.method === 'POST' && req.url === '/action') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        this._handleAction(data, urlSafeName);
                    } catch (e) {
                        // ignore parse errors
                    }
                    res.writeHead(200);
                    res.end('ok');
                });
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        await new Promise((resolve) => {
            this._server.listen(SPY_PORT, '127.0.0.1', () => {
                console.log(`-> [Spy] Action server listening on http://127.0.0.1:${SPY_PORT}`);
                resolve();
            });
        });
    }

    /**
     * Stops the local HTTP server and dynamic field monitoring
     */
    stopActionServer() {
        if (this._server) {
            this._server.close();
            this._server = null;
            console.log(`-> [Spy] Action server stopped`);
        }
        
        // Stop dynamic field monitoring
        const browserService = require('./BrowserActions');
        browserService.stopDynamicFieldMonitoring();
    }

    /**
     * Handles an action received from the browser
     */
    _handleAction(data, urlSafeName) {
        console.log(`-> [Spy] Received: ${data.type} on ${data.selector || data.value || ''}`);
        this.lastActivityTime = Date.now();
        this.lastAction = data;
        const currentUrl = data.pageUrl || '';

        if (!this.sessionData[urlSafeName]) {
            this.sessionData[urlSafeName] = { inputs: {}, locators: [] };
        }

        if (data.type === "input") {
            if (!this.sessionData[urlSafeName].inputs[currentUrl]) {
                this.sessionData[urlSafeName].inputs[currentUrl] = {};
            }
            this.sessionData[urlSafeName].inputs[currentUrl][data.selector] = data.value;

            if (this.inputTimeout) clearTimeout(this.inputTimeout);
            this.inputTimeout = setTimeout(() => {
                console.log(`-> [Spy] Data Captured: ${data.selector} = ${data.value}`);
                fileService.saveTestData(urlSafeName, this.sessionData[urlSafeName].inputs);
            }, 500);

            // Capture DOM snapshot after each input — catches dynamic fields
            // (e.g. factory address section appearing when user selects "No")
            // Debounced 1s so rapid typing doesn't flood disk
            if (this._domSnapshotTimer) clearTimeout(this._domSnapshotTimer);
            this._domSnapshotTimer = setTimeout(() => {
                if (this._activePage) {
                    this.captureInteractionSnapshot(this._activePage, urlSafeName);
                }
            }, 1000);
        } else {
            console.log(`-> [Spy] Action: ${data.type} on ${data.selector}`);

            // Also capture DOM on click — dropdown selections reveal conditional sections
            if (data.type === 'click') {
                if (this._domSnapshotTimer) clearTimeout(this._domSnapshotTimer);
                this._domSnapshotTimer = setTimeout(() => {
                    if (this._activePage) {
                        this.captureInteractionSnapshot(this._activePage, urlSafeName);
                    }
                }, 800);
            }
        }

        // Add to journey — pick best stable selector using ranked strategy arrays
        // Priority: playwright[0] → aria testId → aria-label → text[0] → css[0] → xpath[0]
        const queueProcessor = require("./QueueProcessor");
        const loc = data.locators || {};
        const tag = (loc.tagName || '').toLowerCase();
        const isInput = ['input', 'select', 'textarea'].includes(tag);
        const isInteractive = ['button', 'a', 'input', 'select', 'textarea', 'summary'].includes(tag);

        // Resolve best single selector from ranked arrays
        let bestSel;
        if (isInput) {
            // Inputs: placeholder → aria-label → name → stable id → css[0]
            bestSel = (loc.playwright || []).find(p => p.startsWith('getByPlaceholder') || p.startsWith('getByLabel'))
                || (loc.aria || []).find(a => a.startsWith('[aria-label'))
                || (loc.css  || []).find(c => c.includes('[placeholder') || c.includes('[name') || c.startsWith('#'))
                || (loc.xpath || []).find(x => x.includes('@placeholder') || x.includes('@name') || x.includes('@id'))
                || loc.cssSelector
                || data.selector;
        } else if (isInteractive) {
            // Buttons/links: role-based → text → aria → css
            bestSel = (loc.playwright || []).find(p => p.startsWith('getByRole') || p.startsWith('getByTestId'))
                || (loc.text || [])[0]
                || (loc.aria || []).find(a => a.startsWith('[aria-label'))
                || (loc.css  || []).find(c => c.startsWith('#') || c.includes('[data-testid'))
                || (loc.xpath || [])[0]
                || loc.cssSelector
                || data.selector;
        } else {
            // Other elements: testId → aria → id → css
            bestSel = (loc.playwright || []).find(p => p.startsWith('getByTestId'))
                || (loc.aria || []).find(a => a.startsWith('[data-testid') || a.startsWith('[aria-label'))
                || (loc.css  || []).find(c => c.startsWith('#'))
                || (loc.xpath || [])[0]
                || loc.cssSelector
                || data.selector;
        }

        queueProcessor.addActionToJourney({
            type:      data.type,
            url:       currentUrl,
            selector:  bestSel,
            value:     data.value   || null,
            text:      data.text    || null,
            locators:  data.locators || {},
            timestamp: Date.now()
        });

        // Save locators - deduplicate by url + cssSelector + type + innerText
        const cssSelector = loc.cssSelector || data.selector;
        const innerText = loc.innerText || data.text || '';
        const existingIndex = this.sessionData[urlSafeName].locators.findIndex(existing => {
            const eLoc = existing.locators || {};
            const eCss = eLoc.cssSelector;
            const eText = eLoc.innerText || existing.text || '';
            if (data.type === 'click') {
                return existing.type === 'click' && existing.url === currentUrl && eCss === cssSelector && eText === innerText;
            } else {
                return existing.url === currentUrl && eCss === cssSelector;
            }
        });

        const locatorEntry = {
            type:      data.type,
            url:       currentUrl,
            timestamp: Date.now(),
            value:     data.value || null,
            text:      data.text  || null,
            // ── Full ranked strategy structure ────────────────────────────────
            locators: {
                // Ranked arrays (new — used by JourneyToPlaywright + AI prompts)
                playwright:  loc.playwright  || [],
                xpathList:   loc.xpath       || [],   // array — named xpathList to avoid key collision
                cssList:     loc.css         || [],   // array
                textList:    loc.text        || [],   // array
                ariaList:    loc.aria        || [],   // array
                // Flat meta fields (backward compat)
                id:          loc.id          || null,
                name:        loc.name        || null,
                tagName:     loc.tagName     || null,
                innerText:   loc.innerText   || null,
                placeholder: loc.placeholder || null,
                ariaLabel:   loc.ariaLabel   || null,
                testId:      loc.testId      || null,
                cssSelector: loc.cssSelector || null,
                xpath:       (loc.xpath      || [])[0] || null,
                textXPath:   (loc.text       || [])[0] || null,
                ariaXPath:   (loc.aria       || []).find(a => a.startsWith('[aria-label')) || null,
                placeholderXPath: loc.placeholderXPath || null,
                nameXPath:   loc.nameXPath   || null,
                idXPath:     loc.idXPath     || null,
                nthMatch:    loc.nthMatch    || null,
                nthXPath:    loc.nthXPath    || null,
            }
        };

        if (existingIndex !== -1) {
            if (data.type !== 'click') {
                this.sessionData[urlSafeName].locators[existingIndex] = locatorEntry;
            }
        } else {
            this.sessionData[urlSafeName].locators.push(locatorEntry);
        }

        if (this.locatorTimeout) clearTimeout(this.locatorTimeout);
        this.locatorTimeout = setTimeout(() => {
            fileService.saveLocators(urlSafeName, this.sessionData[urlSafeName].locators);
        }, 500);
    }

    /**
     * Injects the Spy script into the page.
     * Uses fetch() to send actions to the local HTTP server — works across ALL navigations.
     * Also sets up dynamic field monitoring for recapturing DOM + screenshot on field changes.
     */
    async injectSpy(page, urlSafeName) {
        this.isRecording = true;
        this._activePage = page; // store reference for mid-interaction DOM snapshots
        if (!this.sessionData[urlSafeName]) {
            this.sessionData[urlSafeName] = { inputs: {}, locators: [] };
        }

        // Start the local action server
        await this.startActionServer(urlSafeName);

        // Setup dynamic field monitoring (recaptures DOM + screenshot on field changes)
        const browserService = require('./BrowserActions');
        const fileService = require('./FileHandler');
        await browserService.setupDynamicFieldMonitoring(page, urlSafeName, fileService);

        const port = SPY_PORT;

        // Inject the browser-side script via context.addInitScript so it runs on EVERY page load
        const context = page.context();
        await context.addInitScript((spyPort) => {
            // ── Ranked multi-strategy locator builder ────────────────────────
            // Produces { playwright[], xpath[], css[], text[], aria[], meta{} }
            // Each array is ordered best-first within its strategy.
            const buildLocators = (el) => {
                const tag      = el.tagName.toLowerCase();
                const id       = el.id || null;
                const name     = el.name || null;
                const role     = el.getAttribute('role') || null;
                const ariaLabel = el.getAttribute('aria-label') || null;
                const testId   = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy') || null;
                const placeholder = el.getAttribute('placeholder') || null;
                const type     = el.getAttribute('type') || null;

                // ── Auto-generated ID detection (framework-agnostic) ─────────
                // Skips IDs that are clearly auto-generated (end in digits, or
                // start with known framework prefixes like mat-, ng-, cdk-, rc-, etc.)
                const isAutoId = (v) => !v || /[-_]\d+$/.test(v) || /^(mat-|ng-|cdk-|rc-|mdc-|v-|vue-|ember|__)/i.test(v);
                const stableId = id && !isAutoId(id) ? id : null;

                // ── Clean inner text (strip required markers) ────────────────
                const rawText = Array.from(el.childNodes)
                    .filter(n => n.nodeType === 3)
                    .map(n => n.textContent.trim())
                    .join(' ')
                    .trim()
                    .replace(/\s*[*✱†‡]\s*$/, '')
                    .trim()
                    || (el.innerText || '').trim().replace(/\s*[*✱†‡]\s*$/, '').trim();
                const safeText = rawText.length > 0 && rawText.length <= 80 ? rawText : null;
                const shortText = safeText ? safeText.substring(0, 40) : null;

                // ── Helper: escape single quotes for XPath ───────────────────
                const xpEsc = (s) => s.includes("'") ? `concat('${s.split("'").join("',\"'\",'")}')`  : `'${s}'`;

                // ── 1. PLAYWRIGHT role-based locators (highest priority) ──────
                const playwright = [];

                // getByTestId — most stable of all
                if (testId) {
                    playwright.push(`getByTestId('${testId}')`);
                }

                // getByRole with name — works for buttons, links, inputs, checkboxes, etc.
                const roleMap = {
                    button: 'button', a: 'link', input: type === 'checkbox' ? 'checkbox'
                        : type === 'radio' ? 'radio' : type === 'submit' ? 'button' : 'textbox',
                    select: 'combobox', textarea: 'textbox',
                    h1: 'heading', h2: 'heading', h3: 'heading',
                };
                const inferredRole = role || roleMap[tag] || null;
                if (inferredRole && safeText) {
                    playwright.push(`getByRole('${inferredRole}', { name: '${safeText.replace(/'/g, "\\'")}' })`);
                } else if (inferredRole && ariaLabel) {
                    playwright.push(`getByRole('${inferredRole}', { name: '${ariaLabel.replace(/'/g, "\\'")}' })`);
                } else if (inferredRole && placeholder) {
                    playwright.push(`getByRole('${inferredRole}', { name: '${placeholder.replace(/'/g, "\\'")}' })`);
                }

                // getByLabel — for form inputs associated with a <label>
                if (placeholder && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
                    playwright.push(`getByPlaceholder('${placeholder.replace(/'/g, "\\'")}')`);
                }
                if (ariaLabel) {
                    playwright.push(`getByLabel('${ariaLabel.replace(/'/g, "\\'")}')`);
                }

                // getByText — for visible text elements (not inputs)
                if (safeText && !['input', 'textarea', 'select'].includes(tag)) {
                    if (safeText.length <= 40) {
                        playwright.push(`getByText('${safeText.replace(/'/g, "\\'")}', { exact: true })`);
                    } else {
                        playwright.push(`getByText('${safeText.substring(0, 40).replace(/'/g, "\\'")}')`)
                    }
                }

                // ── 2. ARIA locators ─────────────────────────────────────────
                const aria = [];
                if (testId)    aria.push(`[data-testid="${testId}"]`);
                if (ariaLabel) aria.push(`[aria-label="${ariaLabel}"]`);
                if (role)      aria.push(`[role="${role}"]`);

                // ── 3. TEXT locators ─────────────────────────────────────────
                const text = [];
                if (safeText && !['input', 'textarea', 'select'].includes(tag)) {
                    // Exact text match
                    text.push(`xpath=//${tag}[normalize-space()=${xpEsc(safeText)}]`);
                    // Contains match (fallback for dynamic content)
                    if (shortText && shortText !== safeText) {
                        text.push(`xpath=//${tag}[contains(normalize-space(),${xpEsc(shortText)})]`);
                    }
                    // nth-of-type for duplicate text
                    const allSame = Array.from(document.querySelectorAll(tag))
                        .filter(e => (e.innerText || '').trim().replace(/\s*[*✱†‡]\s*$/, '').trim().substring(0, 40) === (shortText || ''));
                    if (allSame.length > 1) {
                        const idx = allSame.indexOf(el) + 1;
                        text.push(`xpath=(//${tag}[normalize-space()=${xpEsc(safeText)}])[${idx}]`);
                    }
                }
                if (placeholder) {
                    text.push(`xpath=//${tag}[@placeholder=${xpEsc(placeholder)}]`);
                }

                // ── 4. XPATH locators ────────────────────────────────────────
                const xpath = [];
                if (stableId)  xpath.push(`xpath=//*[@id="${stableId}"]`);
                if (name)      xpath.push(`xpath=//${tag}[@name="${name}"]`);
                if (ariaLabel) xpath.push(`xpath=//*[@aria-label="${ariaLabel}"]`);
                if (testId)    xpath.push(`xpath=//*[@data-testid="${testId}"]`);
                if (placeholder) xpath.push(`xpath=//${tag}[@placeholder=${xpEsc(placeholder)}]`);
                // Structural XPath as last resort
                const buildStructuralXPath = (el) => {
                    if (el.id && !isAutoId(el.id)) return `//*[@id="${el.id}"]`;
                    if (el.name) return `//${el.tagName.toLowerCase()}[@name="${el.name}"]`;
                    const parts = [];
                    let node = el;
                    while (node && node.nodeType === 1) {
                        let part = node.tagName.toLowerCase();
                        const siblings = node.parentElement
                            ? Array.from(node.parentElement.children).filter(c => c.tagName === node.tagName)
                            : [];
                        if (siblings.length > 1) part += `[${siblings.indexOf(node) + 1}]`;
                        parts.unshift(part);
                        node = node.parentElement;
                        if (parts.length >= 4) break;
                    }
                    return '//' + parts.join('/');
                };
                xpath.push(`xpath=${buildStructuralXPath(el)}`);

                // ── 5. CSS locators ──────────────────────────────────────────
                const css = [];
                if (stableId)  css.push(`#${stableId}`);
                if (name)      css.push(`${tag}[name="${name}"]`);
                if (testId)    css.push(`[data-testid="${testId}"]`);
                if (placeholder) css.push(`${tag}[placeholder="${placeholder}"]`);
                if (ariaLabel) css.push(`[aria-label="${ariaLabel}"]`);
                // Structural CSS (short, non-positional only)
                const buildStructuralCss = (el) => {
                    if (el.id && !isAutoId(el.id)) return `#${el.id}`;
                    if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
                    const parts = [];
                    let node = el;
                    for (let i = 0; i < 3 && node && node.tagName; i++) {
                        let part = node.tagName.toLowerCase();
                        if (node.id && !isAutoId(node.id)) { parts.unshift(`#${node.id}`); break; }
                        const siblings = node.parentElement
                            ? Array.from(node.parentElement.children).filter(c => c.tagName === node.tagName)
                            : [];
                        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
                        parts.unshift(part);
                        node = node.parentElement;
                    }
                    return parts.join(' > ');
                };
                const structCss = buildStructuralCss(el);
                if (structCss && !structCss.includes(':nth-of-type') && structCss.split('>').length <= 3) {
                    css.push(structCss);
                }

                // ── Meta fields (kept for backward compat + dedup logic) ─────
                return {
                    // ── Ranked strategy arrays (new) ──────────────────────────
                    playwright,   // [ "getByRole(...)", "getByPlaceholder(...)", ... ]
                    xpath,        // [ "xpath=//...", ... ]
                    css,          // [ "#id", "tag[attr]", ... ]
                    text,         // [ "xpath=//tag[normalize-space()=...]", ... ]
                    aria,         // [ "[aria-label=...]", "[role=...]", ... ]

                    // ── Flat meta fields (backward compat) ────────────────────
                    id:          stableId,
                    name,
                    tagName:     tag,
                    innerText:   safeText ? safeText.substring(0, 80) : null,
                    placeholder,
                    ariaLabel,
                    testId,
                    // Best single selector (used by legacy code paths)
                    cssSelector: css[0] || structCss || null,
                    xpath:       xpath[0] || null,
                    textXPath:   text[0]  || null,
                    ariaXPath:   aria.find(a => a.startsWith('[aria-label')) || null,
                    placeholderXPath: placeholder ? `xpath=//${tag}[@placeholder=${xpEsc(placeholder)}]` : null,
                    nameXPath:   name ? `xpath=//${tag}[@name="${name}"]` : null,
                    idXPath:     stableId ? `xpath=//*[@id="${stableId}"]` : null,
                    nthMatch:    (() => {
                        if (!shortText) return null;
                        const allSame = Array.from(document.querySelectorAll(tag))
                            .filter(e => (e.innerText || '').trim().substring(0, 40) === shortText);
                        return allSame.length > 1 ? allSame.indexOf(el) + 1 : null;
                    })(),
                    nthXPath:    (() => {
                        if (!safeText) return null;
                        const allSame = Array.from(document.querySelectorAll(tag))
                            .filter(e => (e.innerText || '').trim().replace(/\s*[*✱†‡]\s*$/, '').trim().substring(0, 40) === (shortText || ''));
                        if (allSame.length <= 1) return null;
                        const idx = allSame.indexOf(el) + 1;
                        return `xpath=(//${tag}[normalize-space()=${xpEsc(safeText)}])[${idx}]`;
                    })(),
                };
            };

            const getActionSelector = (el) => {
                const name = el.name || el.id || el.getAttribute('placeholder') || el.tagName.toLowerCase();
                return name.replace(/[^a-zA-Z0-9_]/g, '');
            };

            const resolveClickTarget = (el) => {
                const CLICKABLE_TAGS = new Set(['a', 'button', 'select', 'summary']);
                const CLICKABLE_ROLES = new Set(['tab', 'button', 'link', 'menuitem', 'option', 'checkbox', 'radio', 'switch']);
                // Auto-generated ID patterns to ignore (Angular, React, etc.)
                const isAutoId = (id) => !id || /[-_]\d+$/.test(id) || /^(mat-|ng-|cdk-)/.test(id);
                let node = el;
                for (let i = 0; i < 5 && node && node !== document.body; i++) {
                    const tag  = (node.tagName || '').toLowerCase();
                    const role = (node.getAttribute('role') || '').toLowerCase();
                    // Only stop at stable IDs, not auto-generated ones
                    const hasStableId = node.id && !isAutoId(node.id);
                    if (hasStableId || CLICKABLE_TAGS.has(tag) || CLICKABLE_ROLES.has(role)) return node;
                    node = node.parentElement;
                }
                return el;
            };

            // ── Send action to local Node.js server via fetch ────────────────
            const sendAction = (data) => {
                data.pageUrl = window.location.href;
                fetch(`http://127.0.0.1:${spyPort}/action`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                    keepalive: true
                }).catch(() => {}); // silently ignore network errors
            };

            // ── Click listener ───────────────────────────────────────────────
            window.addEventListener('click', (e) => {
                const target = resolveClickTarget(e.target);
                const selector = target.tagName.toLowerCase() +
                    (target.id ? `#${target.id}` : '') +
                    (target.className && typeof target.className === 'string'
                        ? '.' + target.className.trim().split(/\s+/).join('.')
                        : '');
                sendAction({
                    type:     'click',
                    selector: selector,
                    text:     (target.innerText || target.textContent || '').trim().substring(0, 80),
                    locators: buildLocators(target)
                });
            }, true);

            // ── Input listener ───────────────────────────────────────────────
            let debounceTimer;
            const handleInput = (e) => {
                const el = e.target;
                const tag = (el.tagName || '').toLowerCase();
                if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return;
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    sendAction({
                        type:     'input',
                        selector: getActionSelector(el),
                        value:    el.value !== undefined ? el.value : '',
                        locators: buildLocators(el)
                    });
                }, 300);
            };

            window.addEventListener('input',    handleInput, true);
            window.addEventListener('change',   handleInput, true);
            window.addEventListener('blur',     handleInput, true);
            window.addEventListener('keyup',    handleInput, true);
            window.addEventListener('focusout', handleInput, true);

            // ── Hash-change ──────────────────────────────────────────────────
            window.addEventListener('hashchange', () => {
                sendAction({
                    type:     'hashchange',
                    selector: 'window',
                    value:    window.location.hash,
                    locators: { cssSelector: null, id: null, name: null, xpath: null,
                                tagName: 'window', innerText: window.location.hash }
                });
            });

            console.log('[Spy]  Spy listeners active on:', window.location.href);
        }, port);

        console.log(`-> [Spy]  Spy script injected (fetch-based, port ${port})`);

        // ── iframe monitoring ────────────────────────────────────────────────
        // The addInitScript above runs on ALL frames (including iframes) automatically
        // because it's added to the context. But we also monitor for dynamically
        // created iframes that might load after the initial page.
        page.on('frameattached', (frame) => {
            console.log(`-> [Spy] iframe attached: ${frame.url() || '(about:blank)'}`);
        });
    }

    /**
     * No longer needed - fetch-based spy works automatically on every page load.
     * Kept for compatibility but does nothing.
     */
    async reinjectSpyOnCurrentPage(page, urlSafeName) {
        // fetch-based spy via context.addInitScript() runs automatically on every navigation
        // No manual re-injection needed
        console.log(`-> [Spy]  Spy active (fetch-based, auto-persists across navigations)`);
    }

    async handleNavigation(page, urlSafeName) {
        const currentUrl = page.url();

        // Prevent double capture for same URL within 2 seconds
        if (this.lastNavUrl === currentUrl && (Date.now() - this.lastNavTime < 2000)) {
            return null;
        }

        // ── Skip redirect / transient URLs ────────────────────────────────────
        const config = require('../config/UtilityConfig');
        if (config.isRedirectOrTransientUrl(currentUrl)) {
            console.log(`-> [Listener] Skipping redirect/transient URL: ${currentUrl}`);
            return null;
        }

        this.lastNavUrl = currentUrl;
        this.lastNavTime = Date.now();

        console.log(`-> [Listener] Capturing DOM + screenshot for: ${currentUrl}`);

        // Capture DOM + full-page screenshot for agent visual understanding
        const browserService = require('./BrowserActions');
        let extraction = await browserService.extractDOMAndScreenshot();
        
        // ── Self-Heal: Retry for First Page ──────────────────────────────────
        // If HTML is empty, it usually means we caught the page mid-navigation.
        const isFirstPage = !this.lastNavUrl;
        if ((!extraction.cleanHtml || extraction.cleanHtml.length < 50) && isFirstPage) {
            console.log(`-> [Listener] First page state unstable. Retrying in 1.5s...`);
            await new Promise(resolve => setTimeout(resolve, 1500));
            extraction = await browserService.extractDOMAndScreenshot();
        }

        if (!extraction.cleanHtml || extraction.cleanHtml.length < 50) {
            console.log(`-> [Listener] Capture skipped for ${currentUrl} (Page state not stable)`);
            return null;
        }

        const cleanHtml = extraction.cleanHtml;
        const encodedString = extraction.encodedString;

        const stepName = currentUrl.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100);
        fileService.saveLayout(stepName, cleanHtml, encodedString);

        return {
            url: currentUrl,
            stepName: stepName,
            triggerSelector: this.lastAction?.selector || "Direct"
        };
    }

    /**
     * Captures the current DOM state mid-interaction (called after each user input).
     * This catches dynamic fields that appear/disappear based on user selections
     * (e.g. factory address section appearing when "No" is selected).
     * REPLACES the existing DOM file (no timestamped copies) so only the latest
     * state is preserved — this keeps storage clean and ensures agent always sees
     * the most recent DOM with all dynamic fields visible.
     */
    async captureInteractionSnapshot(page, urlSafeName) {
        try {
            const currentUrl = page.url();
            
            // ── Skip redirect / transient URLs ────────────────────────────────────
            const config = require('../config/UtilityConfig');
            if (config.isRedirectOrTransientUrl(currentUrl)) {
                console.log(`-> [Snapshot] Skipping redirect/transient URL: ${currentUrl}`);
                return;
            }
            
            const browserService = require('./BrowserActions');
            const { cleanHtml, encodedString } = await browserService.extractDOMAndScreenshot();
            
            const stepName = currentUrl.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100);

            // REPLACE the main DOM file (no timestamped snapshots)
            // This ensures only the latest state with all dynamic fields is saved
            fileService.saveLayout(stepName, cleanHtml, encodedString);

            console.log(`-> [Snapshot] DOM + screenshot captured mid-interaction for: ${currentUrl}`);
        } catch (e) {
            // Never crash recording due to snapshot failure
            console.warn(`-> [Snapshot] Failed to capture: ${e.message}`);
        }
    }
}

module.exports = new Recorder();
