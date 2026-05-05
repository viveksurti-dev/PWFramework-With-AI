import { expect } from '@playwright/test';

export class CommonVerifications {
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

  async verifyURL(url) {
    await expect(this.page).toHaveURL(url);
  }

  async verifyURLContains(text) {
    await expect(this.page).toHaveURL(new RegExp(text));
  }

  async verifyElementVisible(selector) {
    const sel = this._getSelector(selector);
    await expect(this.page.locator(sel)).toBeVisible();
  }

  async verifyPageContains(text) {
    await expect(this.page.locator('body')).toContainText(text);
  }

  /**
   * Universal error verification. Checks common error selectors (#error, .error, etc.)
   */
  async verifyErrorVisible() {
    // Try multiple common error selectors
    const errorSelectors = ['#error', '.error', '[role="alert"]', '.alert-danger', '.message-error'];
    let found = false;
    
    for (const selector of errorSelectors) {
      if (await this.page.isVisible(selector)) {
        await expect(this.page.locator(selector)).toBeVisible();
        found = true;
        break;
      }
    }

    if (!found) {
      // Fallback: If no specific container is found, check if the page contains the word "invalid" or "error"
      const bodyText = await this.page.innerText('body');
      if (bodyText.toLowerCase().includes('invalid') || bodyText.toLowerCase().includes('error')) {
        found = true;
      }
    }

    if (!found) {
      throw new Error("Expected error message was not found on the page.");
    }
  }
}