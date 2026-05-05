const fileService = require("./FileHandler");

class Listener {
    constructor() {
        this.actionQueue = [];
        this.sessionData = {};
        this.isRecording = false;
        this.lastActivityTime = Date.now(); // Track inactivity
    }

    /**
     * Injects the Spy script into the page to listen for user interactions
     */
    async injectSpy(page, urlSafeName) {
        this.isRecording = true;
        if (!this.sessionData[urlSafeName]) {
            this.sessionData[urlSafeName] = {
                inputs: {},
                locators: []   // ordered list of every captured action with full locator info
            };
        }

        // Expose a function for the browser to call Node.js
        await page.exposeFunction("onUserAction", (data) => {
            this.lastActivityTime = Date.now(); // Reset idle timer
            this.lastAction = data; // Track the most recent action for navigation context
            const currentUrl = page.url();
            
            if (data.type === "input") {
                if (!this.sessionData[urlSafeName].inputs[currentUrl]) {
                    this.sessionData[urlSafeName].inputs[currentUrl] = {};
                }
                // Store nested by URL
                this.sessionData[urlSafeName].inputs[currentUrl][data.selector] = data.value;
                
                // Debounced saving (only log/save when user stops typing)
                if (this.inputTimeout) clearTimeout(this.inputTimeout);
                this.inputTimeout = setTimeout(() => {
                    console.log(`-> [Spy] Data Captured: ${data.selector} = ${data.value}`);
                    fileService.saveTestData(urlSafeName, this.sessionData[urlSafeName].inputs);
                }, 500);
            } else {
                console.log(`-> [Spy] Action: ${data.type} on ${data.selector}`);
            }

            // Record full locator info for every action (click + input)
            // Deduplicate by element signature (url + cssSelector + type)
            // For clicks: dedupe by url+css+type (only save first click)
            // For inputs: dedupe by url+css (update value on each input)
            const cssSelector = data.locators?.cssSelector || data.selector;
            const elementSignature = data.type === 'click' 
                ? `${currentUrl}::${cssSelector}::click`
                : `${currentUrl}::${cssSelector}`;
            
            const existingIndex = this.sessionData[urlSafeName].locators.findIndex(loc => {
                const locCss = loc.locators?.cssSelector;
                if (data.type === 'click') {
                    return loc.type === 'click' && loc.url === currentUrl && locCss === cssSelector;
                } else {
                    return loc.url === currentUrl && locCss === cssSelector;
                }
            });

            const locatorEntry = {
                type:        data.type,
                url:         currentUrl,
                timestamp:   Date.now(),
                value:       data.value || null,
                text:        data.text  || null,
                locators: {
                    id:          data.locators?.id          || null,
                    name:        data.locators?.name        || null,
                    cssSelector: data.locators?.cssSelector || null,
                    xpath:       data.locators?.xpath       || null,
                    placeholder: data.locators?.placeholder || null,
                    ariaLabel:   data.locators?.ariaLabel   || null,
                    testId:      data.locators?.testId      || null,
                    tagName:     data.locators?.tagName     || null,
                    innerText:   data.locators?.innerText   || null,
                }
            };

            // For clicks: only add if not exists (don't update)
            // For inputs: update existing or add new
            if (existingIndex !== -1) {
                if (data.type !== 'click') {
                    // Update timestamp and value for input fields
                    this.sessionData[urlSafeName].locators[existingIndex] = locatorEntry;
                }
                // For clicks, do nothing (keep first occurrence)
            } else {
                // New element
                this.sessionData[urlSafeName].locators.push(locatorEntry);
            }

            // Debounced save of locator map
            if (this.locatorTimeout) clearTimeout(this.locatorTimeout);
            this.locatorTimeout = setTimeout(() => {
                fileService.saveLocators(urlSafeName, this.sessionData[urlSafeName].locators);
            }, 500);
        });

        // Inject the browser-side script
        await page.addInitScript(() => {
            // ── Locator builder ──────────────────────────────────────────────
            const buildLocators = (el) => {
                // Best CSS selector: prefer id, then name, then a short unique path
                const buildCss = (el) => {
                    if (el.id) return `#${el.id}`;
                    if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
                    // Walk up to build a short path (max 3 levels)
                    const parts = [];
                    let node = el;
                    for (let i = 0; i < 3 && node && node.tagName; i++) {
                        let part = node.tagName.toLowerCase();
                        if (node.id) { parts.unshift(`#${node.id}`); break; }
                        const siblings = node.parentElement
                            ? Array.from(node.parentElement.children).filter(c => c.tagName === node.tagName)
                            : [];
                        if (siblings.length > 1) {
                            part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
                        }
                        parts.unshift(part);
                        node = node.parentElement;
                    }
                    return parts.join(' > ');
                };

                // XPath builder: prefer id, then absolute-ish path
                const buildXPath = (el) => {
                    if (el.id) return `//*[@id="${el.id}"]`;
                    if (el.name) return `//${el.tagName.toLowerCase()}[@name="${el.name}"]`;
                    const parts = [];
                    let node = el;
                    while (node && node.nodeType === 1) {
                        let part = node.tagName.toLowerCase();
                        const siblings = node.parentElement
                            ? Array.from(node.parentElement.children).filter(c => c.tagName === node.tagName)
                            : [];
                        if (siblings.length > 1) {
                            part += `[${siblings.indexOf(node) + 1}]`;
                        }
                        parts.unshift(part);
                        node = node.parentElement;
                        if (parts.length >= 4) break; // keep it short
                    }
                    return '/' + parts.join('/');
                };

                return {
                    id:          el.id                              || null,
                    name:        el.name                            || null,
                    cssSelector: buildCss(el),
                    xpath:       buildXPath(el),
                    placeholder: el.getAttribute('placeholder')     || null,
                    ariaLabel:   el.getAttribute('aria-label')      || null,
                    testId:      el.getAttribute('data-testid')     || null,
                    tagName:     el.tagName.toLowerCase(),
                    innerText:   (el.innerText || '').trim().substring(0, 80) || null,
                };
            };

            // ── Legacy selector (kept for backward compat) ───────────────────
            const getActionSelector = (el) => {
                const name = el.name || el.id || el.getAttribute('placeholder') || el.tagName.toLowerCase();
                return name.replace(/[^a-zA-Z0-9_]/g, '');
            };

            // ── Click listener ───────────────────────────────────────────────
            window.addEventListener('click', (e) => {
                const selector = e.target.tagName.toLowerCase() + 
                                (e.target.id ? `#${e.target.id}` : "") + 
                                (e.target.className ? `.${e.target.className.split(' ').join('.')}` : "");
                
                window.onUserAction({
                    type:     "click",
                    selector: selector,
                    text:     e.target.innerText,
                    locators: buildLocators(e.target)
                });
            }, true);

            // ── Input listener ───────────────────────────────────────────────
            let debounceTimer;
            const handleInput = (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    window.onUserAction({
                        type:     "input",
                        selector: getActionSelector(e.target),
                        value:    e.target.value,
                        locators: buildLocators(e.target)
                    });
                }, 300);
            };

            window.addEventListener('input',  handleInput, true);
            window.addEventListener('change', handleInput, true);
            window.addEventListener('blur',   handleInput, true);
            window.addEventListener('keyup',  handleInput, true);
        });
    }

    async handleNavigation(page, urlSafeName) {
        const currentUrl = page.url();
        
        // Prevent double capture for same URL within 2 seconds
        if (this.lastNavUrl === currentUrl && (Date.now() - this.lastNavTime < 2000)) {
            return null;
        }
        
        this.lastNavUrl = currentUrl;
        this.lastNavTime = Date.now();

        console.log(`-> [Listener] Capturing state for: ${currentUrl}`);
        
        const screenshot = await page.screenshot({ fullPage: true });
        const dom = await page.content();
        
        // Use sanitized URL as the filename (no timestamps)
        const stepName = currentUrl.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100);
        
        fileService.saveLayout(stepName, dom, screenshot.toString('base64'));
        
        return {
            url: currentUrl,
            stepName: stepName,
            triggerSelector: this.lastAction?.selector || "Direct"
        };
    }
}

module.exports = new Listener();
