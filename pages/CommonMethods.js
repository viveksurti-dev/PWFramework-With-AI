import { expect } from '@playwright/test';

export class CommonMethods {
  constructor(page) {
    this.page = page;
  }

  /**
   * Helper to handle both string selectors and object-based selectors (id, xpath, css)
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

  async navigateToUrl(url) {
    await this.page.goto(url);
  }

  async fillInput(selector, value) {
    const sel = this._getSelector(selector);
    if (value === undefined || value === null) {
      console.warn(`[CommonMethods] fillInput called with null/undefined value for ${sel}. Skipping.`);
      return;
    }
    await this.page.fill(sel, String(value));
  }

  async clickElement(selector) {
    const sel = this._getSelector(selector);
    await this.page.click(sel);
  }

  async isVisible(selector) {
    const sel = this._getSelector(selector);
    return await this.page.isVisible(sel);
  }

  async waitForUrl(url, timeout = 10000) {
    await this.page.waitForURL(url, { timeout });
  }
}