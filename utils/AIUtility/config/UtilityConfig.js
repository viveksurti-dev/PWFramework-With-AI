'use strict';

/**
 * UtilityConfig.js — Centralized configuration for the AI E2E Automation Framework.
 *
 * All hardcoded values (timeouts, batch sizes, URLs, keys, selectors) are
 * externalized here. Services import this instead of hardcoding values.
 *
 * To override at runtime, set environment variables (e.g. AI_COOLDOWN_MS=3000).
 */

const path = require('path');

const UtilityConfig = {

    // ─── AI Engine ────────────────────────────────────────────────────────────
    ai: {
        cooldownMs:    parseInt(process.env.AI_COOLDOWN_MS || '5000'),
        maxRetries:    parseInt(process.env.AI_MAX_RETRIES || '3'),
        retryDelayMs:  parseInt(process.env.AI_RETRY_DELAY_MS || '20000'),
    },

    // ─── Browser ──────────────────────────────────────────────────────────────
    browser: {
        headless:      process.env.BROWSER_HEADLESS === 'true',
        waitUntil:     process.env.BROWSER_WAIT_UNTIL || 'domcontentloaded',
        defaultTimeout: parseInt(process.env.BROWSER_TIMEOUT || '30000'),
    },

    // ─── Test Execution ───────────────────────────────────────────────────────
    execution: {
        batchSize:     parseInt(process.env.BATCH_SIZE || '5'),
        testTimeout:   parseInt(process.env.TEST_TIMEOUT || '30000'),
        workers:       parseInt(process.env.TEST_WORKERS || '1'),
    },

    // ─── Captcha ──────────────────────────────────────────────────────────────
    captcha: {
        aesKeyBase64:  process.env.CAPTCHA_AES_KEY || 'Xa/Bc14y7+Y0wq2SFHAuovvsfvnW7PUkKncUstn9z7o=',
        defaultUrl:    process.env.CAPTCHA_URL || 'captcha/gen',
        jsonKey:       process.env.CAPTCHA_JSON_KEY || 'encData',
        timeoutMs:     parseInt(process.env.CAPTCHA_TIMEOUT_MS || '15000'),
        tagLengthBytes: 16,  // AES-GCM auth tag = 128 bits
    },

    // ─── Recording (Listener) ─────────────────────────────────────────────────
    recording: {
        spyPort:           parseInt(process.env.SPY_PORT || '7432'),
        inactivityTimeout: parseInt(process.env.INACTIVITY_TIMEOUT_MS || '60000'),
        inputDebounceMs:   parseInt(process.env.INPUT_DEBOUNCE_MS || '300'),
        locatorSaveDebounceMs: parseInt(process.env.LOCATOR_SAVE_DEBOUNCE_MS || '500'),
    },

    // ─── Flow Generator ───────────────────────────────────────────────────────
    flowGenerator: {
        maxDomChars:       parseInt(process.env.MAX_DOM_CHARS || '8000'),
        maxPromptHtmlChars: parseInt(process.env.MAX_PROMPT_HTML_CHARS || '5000'),
        shortNameMaxLen:   parseInt(process.env.SHORT_NAME_MAX_LEN || '20'),
        flowNameMaxLen:    parseInt(process.env.FLOW_NAME_MAX_LEN || '25'),
    },

    // ─── Self-Healing ─────────────────────────────────────────────────────────
    selfHealing: {
        enabled:       process.env.SELF_HEALING !== 'false',
        maxAttempts:   parseInt(process.env.HEAL_MAX_ATTEMPTS || '1'),
    },

    /**
     * Checks if a URL is a redirect or transient URL that should be skipped.
     * Redirect URLs are intermediate pages that don't contain meaningful content
     * and should not be captured or added to the test queue.
     *
     * @param {string} url - The URL to check
     * @returns {boolean} True if the URL should be skipped
     */
    isRedirectOrTransientUrl(url) {
        if (!url) return true;

        try {
            const u = new URL(url);
            const pathname = u.pathname.toLowerCase();
            
            // Check for redirect patterns
            const isRedirect =
                pathname === '/redirect' ||
                pathname.startsWith('/redirect/') ||
                pathname.endsWith('/redirect') ||
                /\/redirect_\d+/.test(pathname) ||
                /^\/\d+$/.test(pathname) ||
                /^\/\d+\//.test(pathname);
            
            // Check for transient URLs
            const isTransient =
                url.startsWith('about:') ||
                url.startsWith('data:')  ||
                url.startsWith('blob:');

            return isRedirect || isTransient;
        } catch {
            // Invalid URL format
            return true;
        }
    },

    // ─── Error Categories ─────────────────────────────────────────────────────
    errorCategories: {
        SELECTOR_NOT_FOUND: 'selector_not_found',
        TIMEOUT:            'timeout',
        CAPTCHA_FAILED:     'captcha_failed',
        NAVIGATION_ERROR:   'navigation_error',
        ASSERTION_FAILED:   'assertion_failed',
        UNKNOWN:            'unknown',
    },

    /**
     * Categorizes an error message into a known error type.
     * Used by self-healing and reporting to pick the right fix strategy.
     *
     * @param {string} errorMessage - The raw error message from Playwright
     * @returns {string} One of the errorCategories values
     */
    categorizeError(errorMessage) {
        if (!errorMessage) return this.errorCategories.UNKNOWN;
        const msg = errorMessage.toLowerCase();

        if (msg.includes('waiting for locator') || msg.includes('no element matches') ||
            msg.includes('strict mode violation') || msg.includes('is not a function')) {
            return this.errorCategories.SELECTOR_NOT_FOUND;
        }
        if (msg.includes('timeout') || msg.includes('exceeded') || msg.includes('timed out')) {
            return this.errorCategories.TIMEOUT;
        }
        if (msg.includes('captcha') || msg.includes('decrypt') || msg.includes('aes') ||
            msg.includes('authenticate data')) {
            return this.errorCategories.CAPTCHA_FAILED;
        }
        if (msg.includes('navigation') || msg.includes('net::err') || msg.includes('page.goto') ||
            msg.includes('waitforurl')) {
            return this.errorCategories.NAVIGATION_ERROR;
        }
        if (msg.includes('expect') || msg.includes('assertion') || msg.includes('tohaveurl') ||
            msg.includes('tobevisible') || msg.includes('tocontaintext')) {
            return this.errorCategories.ASSERTION_FAILED;
        }

        return this.errorCategories.UNKNOWN;
    },

    /**
     * Validates that selectors in generated code actually exist in the saved DOM.
     * Returns an array of invalid selectors found.
     *
     * @param {string} generatedCode - The generated test/page code
     * @param {string} domHtml       - The saved DOM HTML for the page
     * @returns {Array<{selector: string, line: number}>} Invalid selectors
     */
    validateSelectors(generatedCode, domHtml) {
        if (!generatedCode || !domHtml) return [];

        const invalidSelectors = [];
        const lines = generatedCode.split('\n');

        // Extract selectors from common patterns:
        // fillInput('#selector', ...), clickElement('#selector'), page.locator('#selector')
        const selectorRegex = /(?:fillInput|clickElement|locator|waitForSelector|isVisible)\s*\(\s*['"`]([^'"`]+)['"`]/g;

        for (let i = 0; i < lines.length; i++) {
            let match;
            const lineRegex = new RegExp(selectorRegex.source, 'g');
            while ((match = lineRegex.exec(lines[i])) !== null) {
                const selector = match[1];

                // Skip dynamic/xpath/role selectors — can't validate statically
                if (selector.startsWith('xpath=') || selector.startsWith('//') ||
                    selector.includes('getByRole') || selector.includes('getByText') ||
                    selector === 'body' || selector === 'window') {
                    continue;
                }

                // Validate ID selectors: #someId → check if id="someId" exists in DOM
                if (selector.startsWith('#')) {
                    const id = selector.substring(1);
                    if (!domHtml.includes(`id="${id}"`) && !domHtml.includes(`id='${id}'`)) {
                        invalidSelectors.push({ selector, line: i + 1 });
                    }
                }
                // Validate name selectors: [name="xxx"]
                else if (selector.includes('[name="')) {
                    const nameMatch = selector.match(/\[name="([^"]+)"\]/);
                    if (nameMatch && !domHtml.includes(`name="${nameMatch[1]}"`)) {
                        invalidSelectors.push({ selector, line: i + 1 });
                    }
                }
                // Validate class selectors: .className
                else if (selector.startsWith('.') && !selector.includes(' ') && !selector.includes('>')) {
                    const className = selector.substring(1);
                    if (!domHtml.includes(`class="`) || !domHtml.includes(className)) {
                        invalidSelectors.push({ selector, line: i + 1 });
                    }
                }
            }
        }

        return invalidSelectors;
    }
};

module.exports = UtilityConfig;
