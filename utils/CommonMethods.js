export class CommonMethods {
  constructor(page) {
    this.page = page;
  }

  async doClick(locator) {
    await locator.waitFor({ state: "visible", timeout: 5000 });
    await locator.click();
  }

  async doFill(locator, value) {
    await locator.waitFor({ state: "visible", timeout: 5000 });
    await locator.fill(value);
  }

  async isVisible(locator) {
    await locator.waitFor({ state: "visible", timeout: 10000 });
    return await locator.isVisible();
  }

  async fillInput(locatorOrSelector, value) {
  const actualLocator = typeof locatorOrSelector === 'object' 
    ? locatorOrSelector 
    : this.page.locator(locatorOrSelector);
  await actualLocator.fill(value);
  }

  async clickElement(locatorOrSelector) {
    const actualLocator = typeof locatorOrSelector === 'object' 
      ? locatorOrSelector 
      : this.page.locator(locatorOrSelector);
    await this.doClick(actualLocator);
  }
}
