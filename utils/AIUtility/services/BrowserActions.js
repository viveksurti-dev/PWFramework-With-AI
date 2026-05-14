const { chromium } = require("playwright");
const config = require("../config/UtilityConfig");

class BrowserService {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async init() {
    this.browser = await chromium.launch({ 
      headless: config.browser.headless,
      devtools: true,
      args: ["--start-maximized"] 
    });
    this.context = await this.browser.newContext({
      viewport: null
    });
    this.page = await this.context.newPage();
    
    // Listen to browser console messages
    this.page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[Browser]')) {
        console.log(`  ${text}`);
      }
    });
    
    return this.page;
  }

  async navigateTo(url) {
    if (!this.page) throw new Error("Page not initialized");
    console.log(`\nLaunching Playwright Browser for: ${url}...`);
    await this.page.goto(url, { waitUntil: config.browser.waitUntil });
  }

  async extractDOMAndScreenshot(captureScreenshot = true) {
    if (!this.page) throw new Error("Page not initialized");
    
    let cleanHtml = "";
    let encodedString = "";

    try {
        console.log("-> [Extraction] Expanding dropdowns and collapsed elements...");
        await this.page.evaluate(() => {
            try {
                document.querySelectorAll('[data-bs-toggle="dropdown"], [data-toggle="dropdown"], .dropdown-toggle').forEach(el => el.click());
                document.querySelectorAll('[data-bs-toggle="collapse"], [data-toggle="collapse"], .accordion-button').forEach(el => {
                    if(el.getAttribute('aria-expanded') === 'false') el.click();
                });
                document.querySelectorAll('details:not([open])').forEach(el => el.setAttribute('open', 'true'));
            } catch (e) { /* ignore evaluate errors */ }
        });

        console.log("-> [Extraction] Cleaning DOM...");
        cleanHtml = await this.page.evaluate(() => {
            try {
                const clone = document.body.cloneNode(true);
                const elementsToRemove = clone.querySelectorAll('script, style, noscript, svg');
                elementsToRemove.forEach(el => el.remove());
                return clone.innerHTML;
            } catch (e) { return ""; }
        });

        if (captureScreenshot) {
            console.log("-> [Extraction] Taking screenshot with aggressive compression...");
            try {
                const buffer = await this.page.screenshot({ fullPage: true, type: 'png' });
                const originalSizeKB = Math.ceil(buffer.length / 1024);
                console.log(`-> [Extraction] Original screenshot: ${originalSizeKB}KB`);
                
                try {
                    const sharp = require('sharp');
                    const compressedBuffer = await sharp(buffer)
                        .resize(1280, null, { fit: 'inside', withoutEnlargement: true })
                        .jpeg({ quality: 40, progressive: true, mozjpeg: true })
                        .toBuffer();
                    
                    const compressedSizeKB = Math.ceil(compressedBuffer.length / 1024);
                    const reduction = Math.round((1 - compressedBuffer.length / buffer.length) * 100);
                    console.log(`-> [Extraction] Compressed: ${compressedSizeKB}KB (${reduction}% reduction)`);
                    encodedString = compressedBuffer.toString('base64');
                } catch (sharpErr) {
                    const compressedBuffer = await this.page.screenshot({ fullPage: true, quality: 40, type: 'jpeg' });
                    encodedString = compressedBuffer.toString('base64');
                }
            } catch (err) {
                console.log("-> [Extraction] Screenshot skipped: " + err.message);
            }
        }
    } catch (err) {
        if (err.message.includes("context was destroyed") || err.message.includes("Navigation") || err.message.includes("closed")) {
            console.warn("-> [Extraction] Skipping capture: Page navigated or closed during extraction.");
        } else {
            console.error("-> [Extraction] Unexpected error:", err.message);
        }
    }

    return { cleanHtml, encodedString };
  }

  /**
   * Monitors field changes and recaptures DOM + screenshot when dynamic content loads.
   * Replaces existing files instead of creating new ones.
   * Used during recording to capture dynamic fields (dropdowns loading options, conditional sections).
   */
  async setupDynamicFieldMonitoring(page, urlSafeName, fileHandler) {
    if (!page) throw new Error("Page not initialized");
    
    console.log("-> [Dynamic Monitor] Setting up field change monitoring...");
    
    // Store reference for recapture
    this._monitoredPage = page;
    this._monitoredUrlSafeName = urlSafeName;
    this._monitoredFileHandler = fileHandler;
    this._recaptureDebounceTimer = null;
    
    // Inject monitoring script into page
    await page.evaluate(() => {
      // Track which fields have been monitored to avoid duplicate captures
      window.__dynamicFieldsMonitored = window.__dynamicFieldsMonitored || new Set();
      
      // Monitor for DOM mutations (conditional sections appearing/disappearing)
      const mutationObserver = new MutationObserver((mutations) => {
        let hasSignificantChange = false;
        
        for (const mutation of mutations) {
          // Check if new form fields or sections were added
          if (mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === 1) { // Element node
                const hasFormFields = node.querySelector && (
                  node.querySelector('input, select, textarea, button') ||
                  node.matches('input, select, textarea, button')
                );
                if (hasFormFields) {
                  hasSignificantChange = true;
                  break;
                }
              }
            }
          }
          
          // Check if sections were removed
          if (mutation.removedNodes.length > 0) {
            for (const node of mutation.removedNodes) {
              if (node.nodeType === 1) {
                const hasFormFields = node.querySelector && (
                  node.querySelector('input, select, textarea, button') ||
                  node.matches('input, select, textarea, button')
                );
                if (hasFormFields) {
                  hasSignificantChange = true;
                  break;
                }
              }
            }
          }
          
          if (hasSignificantChange) break;
        }
        
        if (hasSignificantChange) {
          console.log('[Browser] Dynamic content detected - triggering recapture');
          window.__triggerRecapture = true;
        }
      });
      
      // Observe the entire document for changes
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false
      });
      
      // Monitor dropdown changes (options loading dynamically)
      const monitorDropdown = (select) => {
        const selectId = select.id || select.name || select.getAttribute('placeholder') || 'unknown';
        if (window.__dynamicFieldsMonitored.has(selectId)) return;
        
        select.addEventListener('change', () => {
          console.log('[Browser] Dropdown changed:', selectId);
          window.__triggerRecapture = true;
        });
        
        // Monitor for options being added dynamically
        const optionObserver = new MutationObserver(() => {
          console.log('[Browser] Dropdown options changed:', selectId);
          window.__triggerRecapture = true;
        });
        
        optionObserver.observe(select, {
          childList: true,
          subtree: true
        });
        
        window.__dynamicFieldsMonitored.add(selectId);
      };
      
      // Monitor all existing dropdowns
      document.querySelectorAll('select').forEach(monitorDropdown);
      
      // Monitor for new dropdowns being added
      const dropdownObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === 1) {
                if (node.matches('select')) {
                  monitorDropdown(node);
                }
                node.querySelectorAll && node.querySelectorAll('select').forEach(monitorDropdown);
              }
            }
          }
        }
      });
      
      dropdownObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
      
      console.log('[Browser] Dynamic field monitoring active');
    });
    
    // Poll for recapture trigger
    this._monitoringInterval = setInterval(async () => {
      try {
        const shouldRecapture = await page.evaluate(() => {
          if (window.__triggerRecapture) {
            window.__triggerRecapture = false;
            return true;
          }
          return false;
        });
        
        if (shouldRecapture) {
          // Debounce recapture (wait 1.5s for multiple rapid changes to settle)
          if (this._recaptureDebounceTimer) clearTimeout(this._recaptureDebounceTimer);
          this._recaptureDebounceTimer = setTimeout(async () => {
            await this.recaptureDynamicContent(page, urlSafeName, fileHandler);
          }, 1500);
        }
      } catch (err) {
        // Page might be navigating or closed - ignore
      }
    }, 500);
    
    console.log("-> [Dynamic Monitor] Field change monitoring active");
  }

  /**
   * Recaptures DOM + screenshot and REPLACES existing files (doesn't create new ones).
   */
  async recaptureDynamicContent(page, urlSafeName, fileHandler) {
    if (!page) return;
    
    console.log("-> [Dynamic Recapture] Recapturing DOM + screenshot (replacing existing files)...");
    
    try {
      // Wait a bit for animations/transitions to complete
      await page.waitForTimeout(500);
      
      // Extract fresh DOM and screenshot
      const { cleanHtml, encodedString } = await this.extractDOMAndScreenshot();
      
      // Save using the SAME filename - this replaces the old files
      fileHandler.saveLayout(urlSafeName, cleanHtml, encodedString);
      
      console.log("-> [Dynamic Recapture] Updated DOM + screenshot (replaced existing files)");
    } catch (err) {
      console.log("-> [Dynamic Recapture] Error:", err.message);
    }
  }

  /**
   * Stops dynamic field monitoring.
   */
  stopDynamicFieldMonitoring() {
    if (this._monitoringInterval) {
      clearInterval(this._monitoringInterval);
      this._monitoringInterval = null;
    }
    if (this._recaptureDebounceTimer) {
      clearTimeout(this._recaptureDebounceTimer);
      this._recaptureDebounceTimer = null;
    }
    this._monitoredPage = null;
    this._monitoredUrlSafeName = null;
    this._monitoredFileHandler = null;
    console.log("-> [Dynamic Monitor] Stopped field change monitoring");
  }

  async quit() {
    // Stop dynamic monitoring before closing
    this.stopDynamicFieldMonitoring();
    
    if (this.page) await this.page.close();
    if (this.context) await this.context.close();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = new BrowserService();
