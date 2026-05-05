const { chromium } = require("playwright");

class BrowserService {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async init() {
    this.browser = await chromium.launch({ 
      headless: false,
      args: ["--start-maximized"] 
    });
    this.context = await this.browser.newContext({
      viewport: null
    });
    this.page = await this.context.newPage();
    return this.page;
  }

  async navigateTo(url) {
    if (!this.page) throw new Error("Page not initialized");
    console.log(`\nLaunching Playwright Browser for: ${url}...`);
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async extractDOMAndScreenshot() {
    if (!this.page) throw new Error("Page not initialized");
    
    console.log("-> [Extraction] Expanding dropdowns and collapsed elements...");
    await this.page.evaluate(() => {
        try {
            document.querySelectorAll('[data-bs-toggle="dropdown"], [data-toggle="dropdown"], .dropdown-toggle').forEach(el => el.click());
            document.querySelectorAll('[data-bs-toggle="collapse"], [data-toggle="collapse"], .accordion-button').forEach(el => {
                if(el.getAttribute('aria-expanded') === 'false') el.click();
            });
            document.querySelectorAll('details:not([open])').forEach(el => el.setAttribute('open', 'true'));
        } catch (e) { console.error(e); }
    });

    console.log("-> [Extraction] Cleaning DOM...");
    let cleanHtml = "";
    try {
      cleanHtml = await this.page.evaluate(() => {
            const clone = document.body.cloneNode(true);
            const elementsToRemove = clone.querySelectorAll('script, style, noscript, svg');
            elementsToRemove.forEach(el => el.remove());
            return clone.innerHTML;
        });
    } catch (e) {
      console.log("Error cleaning DOM:", e.message);
    }

    console.log("-> [Extraction] Taking full-page screenshot...");
    let encodedString = "";
    try {
      const buffer = await this.page.screenshot({ fullPage: true });
      encodedString = buffer.toString('base64');
    } catch (err) {
      console.log("Error capturing screenshot:", err.message);
    }

    return { cleanHtml, encodedString };
  }

  async quit() {
    if (this.page) await this.page.close();
    if (this.context) await this.context.close();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = new BrowserService();
