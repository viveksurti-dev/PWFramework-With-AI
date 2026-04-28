export class BasePage {
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
}
