import { expect } from '@playwright/test';

export class CommonMethods {
  constructor(page) {
    this.page = page;
  }

  // ─── Captcha ─────────────────────────────────────────────────────────────────

  /**
   * Intercepts the captcha API response, decrypts it, and returns the plain text.
   * Delegates to utils/Captcha.js — same logic as Java's returnCaptch().
   *
   * Start the listener BEFORE the action that triggers the captcha API.
   *
   * @param {string|null} captchaUrl - Partial URL of the captcha endpoint (e.g. "captcha/gen")
   * @param {string}      jsonKey    - JSON key holding the encrypted value (default "encData")
   * @param {number}      timeoutMs  - Max wait in ms (default 15000)
   * @returns {Promise<string>}      - Decrypted plain-text captcha
   */
  async returnCaptcha(captchaUrl = null, jsonKey = 'encData', timeoutMs = 15000) {
    // Dynamic import works in both ESM and CJS — no require() needed
    const { default: Captcha } = await import('../utils/AIUtility/Captcha.js');
    return Captcha.returnCaptcha(this.page, captchaUrl || 'captcha', jsonKey, timeoutMs);
  }

  // ─── Selectors ───────────────────────────────────────────────────────────────

  /**
   * Helper to handle both string selectors and object-based selectors (id, xpath, css)
   * @param {string|object} selector
   * @returns {string}
   */
  _getSelector(selector) {
    if (typeof selector === 'string') return selector;
    if (typeof selector === 'object') {
      if (selector.id) return `#${selector.id}`;
      if (selector.xpath) return `xpath=${selector.xpath}`;
      if (selector.css) return selector.css;
    }
    return selector;
  }

  // ─── Navigation ──────────────────────────────────────────────────────────────

  /**
   * Navigate to a URL.
   * @param {string} url - Full URL to navigate to
   */
  async navigateToUrl(url) {
    await this.page.goto(url);
  }

  /**
   * Wait for the page URL to match.
   * @param {string} url     - URL or pattern to wait for
   * @param {number} timeout - Max wait in ms (default 10000)
   */
  async waitForUrl(url, timeout = 10000) {
    await this.page.waitForURL(url, { timeout });
  }

  // ─── Interactions ────────────────────────────────────────────────────────────

  /**
   * Fill an input field with a value.
   * @param {string|object} selector - CSS selector, ID, or object {id, xpath, css}
   * @param {string}        value    - Value to fill
   */
  async fillInput(selector, value) {
    const sel = this._getSelector(selector);
    if (value === undefined || value === null) {
      console.warn(`[CommonMethods] fillInput called with null/undefined value for ${sel}. Skipping.`);
      return;
    }
    await this.page.fill(sel, String(value));
  }

  /**
   * Click an element.
   * @param {string|object} selector - CSS selector, ID, or object {id, xpath, css}
   */
  async clickElement(selector) {
    const sel = this._getSelector(selector);
    await this.page.click(sel);
  }

  /**
   * Check if an element is visible.
   * @param {string|object} selector - CSS selector, ID, or object {id, xpath, css}
   * @returns {Promise<boolean>}
   */
  async isVisible(selector) {
    const sel = this._getSelector(selector);
    return await this.page.isVisible(sel);
  }
}
