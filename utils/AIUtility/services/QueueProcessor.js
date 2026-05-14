const fs = require("fs");
const path = require("path");
const aiService = require("./AiEngine");
const fileService = require("./FileHandler");
const promptBuilder = require("../Scenario_Creation/PromptBuilder_EndToEnd");

class QueueProcessor {
    constructor() {
        this.queue = [];
        this.processedSteps = new Set();
        this.isProcessing = false;
        this.journey = []; 
        this.queueFilePath = path.join(fileService.queueDir, "queue_status.json");
        this._currentSafeName = null; // tracks which session is active
    }

    /**
     * Call this at the start of each recording session to isolate journeys.
     * Only sets the active safeName — does NOT wipe journey/queue/processedSteps
     * so existing session data and FlowGenerator queue are preserved.
     */
    startSession(safeName) {
        this._currentSafeName = safeName;
        console.log(`-> [Queue] Session started: ${safeName}`);
    }

    /**
     * Returns the per-session journey file path for a given safeName.
     */
    getSessionJourneyPath(safeName) {
        return path.join(fileService.queueDir, `${safeName}_journey.json`);
    }

    /**
     * Saves the shared queue status AND the per-session journey file.
     * Per-session file is written on every action so data survives process exit.
     */
    saveStatus() {
        const dir = path.dirname(this.queueFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // 1. Shared queue file (for FlowGenerator compatibility)
        const data = {
            processedUrls: Array.from(this.processedSteps),
            pendingCount: this.queue.length,
            journey: this.journey,
            status: this.isProcessing ? "Processing" : "Idle",
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(this.queueFilePath, JSON.stringify(data, null, 2));

        // 2. Per-session journey file — written on every action so it survives crashes/exits
        if (this._currentSafeName) {
            const sessionPath = this.getSessionJourneyPath(this._currentSafeName);
            fs.writeFileSync(sessionPath, JSON.stringify({
                safeName:    this._currentSafeName,
                journey:     this.journey,
                lastUpdated: new Date().toISOString()
            }, null, 2));

            // 3. Live background script generation — debounced 2s after last action
            this._scheduleLiveGeneration(this._currentSafeName);
        }
    }

    /**
     * Debounced live generation — regenerates page/verif/spec files 2s after
     * the last recorded action. Runs silently in the background, never blocks recording.
     */
    _scheduleLiveGeneration(safeName) {
        if (this._liveGenTimer) clearTimeout(this._liveGenTimer);
        this._liveGenTimer = setTimeout(() => {
            this._runLiveGeneration(safeName);
        }, 2000);
    }

    async _runLiveGeneration(safeName) {
        const isJ2PEnabled = process.env.J2P !== 'false' && process.env.AUTO_GENERATE_CODE !== 'false';
        
        if (!isJ2PEnabled) {
            return; // Skip J2P generation if either flag is OFF
        }

        try {
            const j2p = require('./JourneyToPlaywright');
            await j2p.generate(safeName);
            console.log(`-> [Live Gen] ✅ Scripts updated (pages/ verif/ tests/)`);
        } catch (e) {
            // Silent for expected early-session states
            if (!e.message.includes('empty') && !e.message.includes('No journey')) {
                console.log(`-> [Live Gen] ⚠ ${e.message}`);
            }
        }
    }

    /**
     * Append a single user action (click / input / scroll / hashchange)
     * to the journey without triggering scenario generation.
     * This gives FlowGenerator the full interaction sequence, not just URL hops.
     */
    addActionToJourney(actionData) {
        // Deduplicate rapid repeated events on the same element
        // (e.g. multiple keyup events while typing — keep only the latest value)
        const last = this.journey[this.journey.length - 1];
        if (
            last &&
            last.type === actionData.type &&
            last.selector === actionData.selector &&
            last.url === actionData.url
        ) {
            // Update value in-place for inputs (keep latest typed value)
            if (actionData.type === 'input') {
                last.value = actionData.value;
                last.timestamp = actionData.timestamp;
                this.saveStatus();
            }
            // For clicks, ignore the duplicate
            return;
        }

        this.journey.push({
            type:      actionData.type,       // "click" | "input" | "scroll" | "hashchange"
            url:       actionData.url,
            selector:  actionData.selector,
            value:     actionData.value  || null,
            text:      actionData.text   || null,
            locators:  actionData.locators || {},
            timestamp: actionData.timestamp || Date.now()
        });

        this.saveStatus();
    }

    addToQueue(stepData) {
        // ── Skip redirect / transient URLs ────────────────────────────────────
        try {
            const u = new URL(stepData.url);
            const pathname = u.pathname.toLowerCase();
            const isRedirect =
                pathname === '/redirect' ||
                pathname.startsWith('/redirect/') ||
                pathname.endsWith('/redirect') ||
                /\/redirect_\d+/.test(pathname) ||
                /^\/\d+$/.test(pathname) ||
                /^\/\d+\//.test(pathname);
            if (isRedirect || stepData.url.startsWith('about:') || stepData.url.startsWith('data:') || stepData.url.startsWith('blob:')) {
                console.log(`-> [Queue] Skipping redirect/transient URL: ${stepData.url}`);
                return;
            }
        } catch {
            console.log(`-> [Queue] Skipping unparseable URL: ${stepData.url}`);
            return;
        }

        if (this.processedSteps.has(stepData.url)) {
            console.log(`-> [Queue] Skipping already processed URL: ${stepData.url}`);
            // Still add to journey so we know the user visited it again in the flow
            this.journey.push({
                url: stepData.url,
                stepName: stepData.stepName,
                timestamp: Date.now()
            });
            this.saveStatus();
            return;
        }
        
        console.log(`-> [Queue] Item added: ${stepData.stepName} (${stepData.url})`);
        const item = {
            ...stepData,
            status: "Pending",
            timestamp: Date.now()
        };
        this.queue.push(item);
        this.journey.push({
            url: stepData.url,
            stepName: stepData.stepName,
            triggerSelector: stepData.triggerSelector || "Direct",
            timestamp: Date.now()
        });

        this.saveStatus();
        
        if (!this.isProcessing) {
            this.processQueue();
        }
    }

    async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        const safeName = this._currentSafeName || "default";
        console.log(`\n-> [Queue] Starting background processing for: ${safeName}`);

        // Initialize a single agent for the whole journey
        const ScenarioAgent = require('../agents/ScenarioAgent');
        this.journeyAgent = new ScenarioAgent(safeName);
        await this.journeyAgent.initialize();

        try {
            await this.processNext();
        } catch (error) {
            console.error(`-> [Queue] Journey processing failed:`, error);
        } finally {
            // Clean up once everything is done
            if (this.journeyAgent) {
                this.journeyAgent.close();
                this.journeyAgent = null;
            }
            this.isProcessing = false;
            console.log("-> [Queue] All background tasks finished.");
        }
    }

    async processNext() {
        if (this.queue.length === 0) {
            this.isProcessing = false;
            this.saveStatus();
            console.log("-> [Queue] All pending steps processed.");
            return;
        }

        this.isProcessing = true;
        const currentItem = this.queue.shift();
        
        try {
            console.log(`\n-> [Queue] ══════════════════════════════════════════`);
            console.log(`-> [Queue] Generating ALL scenarios for: ${currentItem.url}`);
            console.log(`-> [Queue] Next page will NOT be processed until this is complete.`);
            console.log(`-> [Queue] ══════════════════════════════════════════`);

            const htmlFilePath = fileService.getDomFilePath(currentItem.stepName);
            const memoryPath   = fileService.getMemoryPath(currentItem.safeName);

            // ── Validate DOM file exists for this step ────────────────────────
            if (!htmlFilePath) {
                console.warn(`-> [Queue] ⚠ No DOM file found for step: ${currentItem.stepName}`);
                console.warn(`-> [Queue] ⚠ Skipping scenario generation — DOM must be captured before generating.`);
                this.processedSteps.add(currentItem.url);
                this.saveStatus();
                this.processNext();
                return;
            }

            // ── Extract metadata from the saved DOM ───────────────────────────
            // Use the latest DOM snapshot (may have been updated by mid-interaction captures)
            const DomMetadataExtractor = require('../Scenario_Creation/DomMetadataExtractor');
            let domMetadata = null;
            const rawHtml = fileService.getLayoutHtml(currentItem.stepName);
            if (rawHtml) {
                try {
                    domMetadata = DomMetadataExtractor.extract(rawHtml);
                    console.log(`-> [Queue] Metadata: ${domMetadata.inputs.length} inputs, ${domMetadata.dropdowns.length} dropdowns, ${domMetadata.dependencies.length} dependencies`);
                } catch (e) {
                    console.warn(`-> [Queue] Metadata extraction failed: ${e.message}`);
                }
            }

            if (!domMetadata) {
                console.warn(`-> [Queue] ⚠ No metadata extracted — skipping scenario generation`);
                this.processedSteps.add(currentItem.url);
                this.saveStatus();
                this.processNext();
                return;
            }

            // ── Load screenshot if available ──────────────────────────────────
            const screenshotBase64 = fileService.getLayoutImageBase64(currentItem.stepName);
            if (screenshotBase64) {
                console.log(`-> [Queue] Screenshot loaded: ${Math.ceil(screenshotBase64.length / 1024)}KB`);
            }

            // ── Use Agent for scenario generation ─────────────────────────────
            console.log("-> [Queue] Generating scenarios using persistent journey session...");
            const agent = this.journeyAgent;
            
            try {
                // Agent is already initialized in processQueue
                
                // Session-level memory path — ALL pages share ONE scenario file
                const sessionMemoryPath = fileService.getMemoryPath(currentItem.safeName);
                const existingScenarios = fileService.readScenarios(sessionMemoryPath);
                
                // Generate scenarios with metadata + screenshot
                const newScenarios = await agent.generate({
                    page: currentItem.stepName,
                    url: currentItem.url,
                    metadata: domMetadata,
                    screenshot: screenshotBase64, // Compressed base64 screenshot
                    mode: 'e2e'
                });
                
                if (newScenarios.length > 0) {
                    // Continue scenario ID numbering from existing scenarios across ALL pages
                    const currentIdCount = existingScenarios.length;
                    newScenarios.forEach((s, idx) => {
                        s.scenarioId = `TC-AUTO-${currentIdCount + idx + 1}`;
                        // Add missing fields for full scenario format
                        s.module = domMetadata.pageInfo.moduleName || currentItem.stepName;
                        s.expectedResult = s.scenario.replace('To verify', 'Should verify');
                        
                        // PRESERVE AI DATA: Only set defaults if AI didn't provide them
                        s.testData = s.testData || {}; 
                        s.category = s.category || 'Functional';
                        s.testSteps = s.testSteps || [];
                        
                        s.Status = 'not tested';
                        s.remarks = '';
                        s.executedBy = "";
                        s.targetUrl = currentItem.url;
                        s.pageStep = currentItem.stepName;
                    });
                    
                    // Append to single session file (all pages in one file)
                    const fullScenarios = existingScenarios.concat(newScenarios);
                    fileService.saveScenarios(sessionMemoryPath, fullScenarios);
                    console.log(`\n-> [Queue] ✅ ${newScenarios.length} scenarios saved for ${currentItem.url}`);
                    console.log(`-> [Queue] Total scenarios in session: ${fullScenarios.length}`);
                    console.log(`-> [Queue] File: ${sessionMemoryPath}`);

                    // ── NEW: Human-Readable Export ────────────────────────────────
                    const MarkdownExporter = require('./MarkdownExporter');
                    MarkdownExporter.export(currentItem.safeName, fullScenarios, path.dirname(sessionMemoryPath));
                } else {
                    console.warn(`-> [Queue] No scenarios generated for ${currentItem.url}`);
                }
                
            } catch (err) {
                console.error(`-> [Queue] Agent generation failed: ${err.message}`);
            } finally {
                // Agent closure moved to processQueue lifecycle
            }

            // Update Navigation Map
            const navMapPath = path.join(fileService.dataDir, `${currentItem.safeName}_nav.json`);
            let navMap = {};
            if (fs.existsSync(navMapPath)) {
                try { navMap = JSON.parse(fs.readFileSync(navMapPath, "utf8")); } catch(e) {}
            }
            if (currentItem.triggerSelector && currentItem.triggerSelector !== "Direct") {
                navMap[currentItem.triggerSelector] = currentItem.url;
                fs.writeFileSync(navMapPath, JSON.stringify(navMap, null, 2));
            }

            this.processedSteps.add(currentItem.url);
            this.saveStatus();

        } catch (e) {
            console.error(`-> [Queue Error]:`, e.message);
        }

        // ── Process next page ONLY after current page is fully done ───────────
        // This is the key change: next page scenarios don't start until this page
        // has generated ALL its scenarios across all phases.
        console.log(`\n-> [Queue] Current page complete. Processing next page...`);
        this.processNext();
    }

  async waitForCompletion() {
    if (this.queue.length === 0 && !this.isProcessing) {
      return Promise.resolve();
    }
    console.log("-> [Queue] Waiting for pending steps to finish processing...");
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (this.queue.length === 0 && !this.isProcessing) {
          clearInterval(check);
          resolve();
        }
      }, 1000);
    });
  }
}

module.exports = new QueueProcessor();
