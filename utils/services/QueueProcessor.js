const fs = require("fs");
const path = require("path");
const aiService = require("./AiEngine");
const fileService = require("./FileHandler");

class QueueProcessor {
    constructor() {
        this.queue = [];
        this.processedSteps = new Set();
        this.isProcessing = false;
        this.journey = []; 
        this.queueFilePath = path.join(fileService.queueDir, "queue_status.json");
    }

    /**
     * Saves the status and journey sequence
     */
    saveStatus() {
        const dir = path.dirname(this.queueFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const data = {
            processedUrls: Array.from(this.processedSteps),
            pendingCount: this.queue.length,
            journey: this.journey,
            status: this.isProcessing ? "Processing" : "Idle",
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(this.queueFilePath, JSON.stringify(data, null, 2));
    }

    addToQueue(stepData) {
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
            this.processNext();
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
            console.log(`-> [Queue Processor] Generating Full Scenarios for: ${currentItem.url}...`);
            
            const dom = fileService.getLayoutHtml(currentItem.stepName);
            const image = fileService.getLayoutImageBase64(currentItem.stepName);
            const memoryPath = fileService.getMemoryPath(currentItem.safeName);
            let existingScenarios = fileService.readScenarios(memoryPath);

            // Load captured test data for this specific URL
            const allTestData = fileService.readTestEnvironmentData();
            const sessionData = allTestData[currentItem.safeName] || {};
            const specificUrlData = sessionData[currentItem.url] || {};
            const dataContext = Object.keys(specificUrlData).length > 0 
                ? `\n\nCAPTURED TEST DATA FOR THIS URL:\n${JSON.stringify(specificUrlData, null, 2)}\nUse these exact values for positive scenarios.`
                : "";

          const prompt = `You are an expert QA Automation Engineer.

            Analyze the attached screenshot, DOM structure, and contextual flow data.

            Generate high-value integration test scenarios for complete End-to-End workflow validation.
            DO NOT generate unit-level or field-level test cases.
            DO NOT generate UI-related scenarios (like screen layout, colors, fonts).

            CRITICAL - PAGE CONTEXT ANALYSIS:
            Before generating scenarios, carefully examine the DOM and screenshot to identify what this page actually does.
            - If the page does NOT contain a login form (no username/password fields), do NOT generate login or authentication scenarios.
            - If the page is a blog, product listing, contact form, or informational page, generate scenarios relevant to THAT page's functionality.
            - Only generate authentication/login scenarios if the DOM clearly shows username and password input fields.

            STRICT SCENARIO GENERATION ORDER (MANDATORY):
            1. FIRST scenario MUST be the primary Happy Path / Positive end-to-end workflow for THIS specific page.
            2. After the happy path, generate remaining scenarios in this exact order:
            - Edge Case scenarios (boundary values, special characters, max/min lengths)
            - Validation & Error Handling scenarios (required fields, error messages)
            - Negative Scenarios (invalid inputs relevant to THIS page)

            HARD RULE:
            If Scenario 1 is not a complete positive happy-path workflow for THIS page, regenerate internally before responding.
            After the happy path, EVERY remaining scenario must test a failure path, edge case, validation rule, or error condition RELEVANT TO THIS PAGE.

            End-to-End Test Case Scenario Context:
            - First cover the successful user journey (happy path) for THIS page
            - Then cover what can go WRONG in the user journey on THIS page
            - Cover error recovery and system resilience
            - Validate that proper error messages/states appear for invalid actions
            - Verify navigation guards and access control
            - Test boundary conditions and unexpected user behavior
            - Include workflow continuity validation

            ${dataContext}

            CRITICAL CONTEXT:
            We already have ${existingScenarios.length} scenarios.

            DO NOT:
            - Repeat existing scenarios
            - Rephrase semantically similar scenarios
            - Generate UI-related scenarios
            - Generate micro field-level validation
            - Generate redundant flow variations
            - Generate isolated component checks
            - Generate login/authentication scenarios if this page has no login form

            OUTPUT RULES:
            Reply ONLY with a valid JSON array of objects.

            Required Fields:
            scenarioId, module, createdAt, createdBy, scenario, expectedResult, testData, executedDate, executedBy, Status, remarks.

            MANDATORY FORMAT RULES:
            - "scenario" must start with "To verify dont contain any special charachters"
            - "expectedResult" must start with "Should be "
            - First scenario MUST describe successful full end-to-end completion for THIS page
            - Remaining scenarios must describe failure paths, edge cases, or validation checks

            Exact object format:

            {
            "scenarioId": "Unique ID (e.g., TC-001)",
            "module": "Identify the module",
            "createdAt": "Current Date",
            "createdBy": "AI Automation Generator",
            "scenario": "To verify [description...]",
            "expectedResult": "Should be [what should happen...]",
            "testData": "Data to use",
            "executedDate": "",
            "executedBy": "",
            "Status": "not tested",
            "remarks": "NA"
            }`;
            const responseText = await aiService.callAIWithFallback(prompt, image);

            try {
                // Use shared JSON repair utility from FileHandler
                const cleanJson = fileService.repairJsonArray(responseText);
                const newScenarios = JSON.parse(cleanJson);

                if (newScenarios.length > 0) {
                    const currentIdCount = existingScenarios.length;
                    newScenarios.forEach((s, idx) => {
                        s.scenarioId = `TC-AUTO-${currentIdCount + idx + 1}`;
                        s.executedBy = "AI Hybrid Recorder";
                        s.Status = "not tested";
                        s.targetUrl = currentItem.url; // Track exactly where this scenario happens
                    });

                    existingScenarios = existingScenarios.concat(newScenarios);
                    fileService.saveScenarios(memoryPath, existingScenarios);
                    console.log(`-> [Queue Processor] SUCCESS: Appended ${newScenarios.length} NEW scenarios to ${currentItem.safeName}`);
                }
            } catch (e) {
                console.error("-> [Queue Processor] JSON Parse Error:", e.message);
                // Save BOTH the raw response AND the repaired version for debugging
                const timestamp = Date.now();
                fs.writeFileSync(
                    path.join(fileService.dataDir, `debug_queue_raw_${timestamp}.txt`),
                    responseText,
                    "utf8"
                );
                try {
                    const attempted = fileService.repairJsonArray(responseText);
                    fs.writeFileSync(
                        path.join(fileService.dataDir, `debug_queue_repaired_${timestamp}.txt`),
                        attempted,
                        "utf8"
                    );
                    console.log(`-> [Debug] Saved raw and repaired JSON to test-data/ for inspection.`);
                } catch (repairErr) {
                    console.error(`-> [Debug] Could not save repaired JSON:`, repairErr.message);
                }
            }

            // Update Navigation Map
            const navMapPath = path.join(fileService.dataDir, `${currentItem.safeName}_nav.json`);
            let navMap = {};
            if (fs.existsSync(navMapPath)) {
                try { navMap = JSON.parse(fs.readFileSync(navMapPath, "utf8")); } catch(e) {}
            }
            // Map the triggerSelector to the URL it reached
            if (currentItem.triggerSelector && currentItem.triggerSelector !== "Direct") {
                navMap[currentItem.triggerSelector] = currentItem.url;
                fs.writeFileSync(navMapPath, JSON.stringify(navMap, null, 2));
            }

            this.processedSteps.add(currentItem.url);
            this.saveStatus();

        } catch (e) {
            console.error(`-> [Queue Error]:`, e.message);
        }

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
