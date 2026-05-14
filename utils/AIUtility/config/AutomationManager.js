const { execSync } = require("child_process");
const path = require("path");
const aiService = require("../services/AiEngine");
const fs = require("fs");
const browserService = require("../services/BrowserActions");
const fileService = require("../services/FileHandler");
const recorder = require("../services/Recorder");
const queueProcessor = require("../services/QueueProcessor");
const flowGenerator = require("../services/FlowGenerator");
const config = require("./UtilityConfig");
const ScenarioAgent = require('../agents/ScenarioAgent');
const CodeAgent = require('../agents/CodeAgent');

// ── Test mode — set by AppInterface at startup ─────────────────────────────────
// 'unit' → PromptBuilder_Unit  |  'e2e' → PromptBuilder_EndToEnd
let _testMode = 'unit';

// ── Singleton Agent — initialized once, reused across all calls ────────────────
let _scenarioAgent = null;
let _codeAgent = null;

/**
 * Get or initialize the singleton scenario agent.
 * Agent persists across all scenario generation calls to maintain thread continuity.
 */
async function getScenarioAgent() {
    if (!_scenarioAgent) {
        _scenarioAgent = new ScenarioAgent();
        await _scenarioAgent.initialize();
        console.log('-> [AutomationManager] Scenario agent initialized (singleton, will persist)');
    }
    return _scenarioAgent;
}

/**
 * Get or initialize the singleton code agent.
 */
async function getCodeAgent() {
    if (!_codeAgent) {
        _codeAgent = new CodeAgent();
        await _codeAgent.initialize();
        console.log('-> [AutomationManager] Code agent initialized (singleton, will persist)');
    }
    return _codeAgent;
}

/**
 * Close the singleton agent (call this on app shutdown)
 */
function closeScenarioAgent() {
    if (_scenarioAgent) {
        _scenarioAgent.close();
        _scenarioAgent = null;
        console.log('-> [AutomationManager] Scenario agent closed');
    }
}

/**
 * Called by AppInterface after the user selects their test mode.
 * Propagates the mode to FlowGenerator so it uses the correct prompt builder.
 * @param {'unit'|'e2e'} mode
 */
function setTestMode(mode) {
    _testMode = mode;
    flowGenerator.setTestMode(mode);
    console.log(`-> [AutomationManager] Test mode set to: ${mode.toUpperCase()}`);
}

/**
 * Returns the currently selected prompt builder based on test mode.
 * @returns {object} PromptBuilder_Unit or PromptBuilder_EndToEnd
 */
function getPromptBuilder() {
    return _testMode === 'e2e'
        ? require('../Scenario_Creation/PromptBuilder_EndToEnd')
        : require('../Scenario_Creation/PromptBuilder_Unit');
}

async function extractAndGenerateScenarios(url, safeName) {
  try {
    // ── Skip redirect / transient URLs ────────────────────────────────────
    const config = require('./UtilityConfig');
    if (config.isRedirectOrTransientUrl(url)) {
        console.log(`-> [AutomationManager] Skipping redirect/transient URL: ${url}`);
        return;
    }
    
    await browserService.init();
    await browserService.navigateTo(url);
    
    // Extract DOM + compressed screenshot for agent
    const { cleanHtml, encodedString } = await browserService.extractDOMAndScreenshot(true);
    await browserService.quit();

    // Save both DOM and screenshot
    fileService.saveLayout(safeName, cleanHtml, encodedString);
    
    const memoryPath = fileService.getMemoryPath(safeName);

    // ── E2E mode: do NOT inject previous per-page scenarios as context. ────────
    // In E2E, the journey (recorded steps + URLs) is the source of truth.
    // Injecting scenarios from page-1 (e.g. login fields) into page-2 (dashboard)
    // causes the AI to reuse login selectors for unrelated pages.
    // Only Unit mode benefits from the "don't repeat existing scenarios" context.
    let existingScenarios = [];

    if (_testMode === 'unit') {
      existingScenarios = fileService.readScenarios(memoryPath);
      if (existingScenarios.length > 0) {
        console.log(`-> [Memory] Found ${existingScenarios.length} existing scenarios for this page.`);
      }
    } else {
      // E2E mode — start fresh for this page, no cross-page scenario bleed
      console.log(`-> [Memory] E2E mode: skipping previous scenario context to prevent cross-page selector bleed.`);
    }

    // ── Extract metadata from DOM ──────────────────────────────────────────
    console.log("-> [Metadata] Extracting optimized metadata from DOM...");
    const DomMetadataExtractor = require('../Scenario_Creation/DomMetadataExtractor');
    const metadata = DomMetadataExtractor.extract(cleanHtml); // Static call, no 'new' and correct method name
    
    // Identify combinatorial fields for exhaustive coverage hint
    const categoricalFields = DomMetadataExtractor.getCategoricalFields ? DomMetadataExtractor.getCategoricalFields(metadata) : [];
    let combinationsHint = "";
    if (categoricalFields.length > 0) {
        const counts = categoricalFields.map(f => f.options.length);
        const total = counts.reduce((a, b) => a * b, 1);
        combinationsHint = `EXHAUSTIVE MISSION: Generate EXACTLY ${total} scenarios for Phase 2 covering every possible combination of: ${categoricalFields.map(f => `${f.fieldName} (${f.options.length} options)`).join(', ')}.`;
        console.log(`-> [Metadata] Combinatorial Fields: ${categoricalFields.length} | Target Combinations: ${total}`);
    }

    console.log(`-> [Metadata] Extracted: ${metadata.inputs.length} inputs, ${metadata.dropdowns.length} dropdowns, ${metadata.validations.length} validations`);

    // ── Fix 5: Local Combinatorial Generation (Save 100% tokens for combinations) ──
    const LocalScenarioGenerator = require('../services/LocalScenarioGenerator');
    const localScenarios = LocalScenarioGenerator.generate(metadata, safeName);
    
    // ── Fix 3: Truncate Context (Send IDs ONLY, not full scenario titles) ──
    const existingIds = [
        ...existingScenarios.map(s => s.scenarioId),
        ...localScenarios.map(s => s.scenarioId)
    ];

    // ── Use Agent for scenario generation ──────────────────────────────────
    console.log("-> [Agent] Generating smart scenarios (Negatives, Edge cases)...");
    const agent = await getScenarioAgent(); 
    
    try {
      // Generate scenarios
      const newScenarios = await agent.generate({
        page: safeName,
        url: url,
        metadata: metadata,
        screenshot: encodedString,
        mode: _testMode,
        // Update hint to tell AI that combinations are already done locally
        combinationsHint: localScenarios.length > 0 ? 
            `I have already generated ${localScenarios.length} local combinatorial scenarios. SKIP Phase 2 and move directly to Phases 3-6 (Dependencies, Boundary, Negatives).` : 
            combinationsHint,
        existingIds: existingIds 
      });
      
      const allNewScenarios = [...localScenarios, ...newScenarios];
      
      if (allNewScenarios.length > 0) {
        const currentIdCount = existingScenarios.length;
        const validScenarios = [];

        allNewScenarios.forEach((s) => {
          // Skip integrity check for local scenarios (we know they are good)
          if (!s.isLocal) {
            // ── Fix 2: Selector Integrity Guard ──
            const usedFields = s.testData ? Object.keys(s.testData) : [];
            const knownFields = [
                ...metadata.inputs.map(i => i.fieldName),
                ...metadata.dropdowns.map(d => d.fieldName),
                ...metadata.radioGroups.map(r => r.fieldName),
                ...metadata.checkboxes.map(c => c.fieldName)
            ];

            const inventedFields = usedFields.filter(f => !knownFields.includes(f));

            if (inventedFields.length > 0) {
                console.warn(`-> [Agent] REJECTED scenario: Contains invented fields: ${inventedFields.join(', ')}`);
                return; 
            }
          }

          // ── Fix 1: Local ID Mapping (Sequential and Predictable) ──
          s.scenarioId = `TC-AUTO-${currentIdCount + validScenarios.length + 1}`;
          s.module = metadata.pageInfo.moduleName || safeName;
          if (!s.expectedResult) s.expectedResult = s.scenario.replace('To verify', 'Should verify');
          s.testData = s.testData || {}; 
          s.Status = 'Pending';
          s.remarks = '';
          
          validScenarios.push(s);
        });

        if (validScenarios.length === 0 && newScenarios.length > 0) {
           console.error("-> [Agent] ALL generated scenarios were rejected due to selector integrity failures.");
        }
        
        existingScenarios = existingScenarios.concat(validScenarios);
        fileService.saveScenarios(memoryPath, existingScenarios);
        console.log(`-> [Agent] Successfully added ${validScenarios.length} verified scenarios. Total: ${existingScenarios.length}`);
      } else {
        console.log(`-> [Memory] No new scenarios were generated. Total remains: ${existingScenarios.length}`);
      }
      
    } catch (error) {
      console.error(`-> [Agent] Error: ${error.message}`);
      throw error;
    }
    // Note: Don't close agent here - it's a singleton that persists
    
  } catch (e) {
    console.error("-> [Extraction Error]:", e.message);
  } finally {
    await browserService.quit();
  }
}

async function executeTestsNatively(url, safeName, targetScenariosArray) {
  const memoryPath = fileService.getMemoryPath(safeName);
  
  targetScenariosArray = targetScenariosArray.filter((s) => String(s.Status).toLowerCase() !== "skip");
  if (!targetScenariosArray || targetScenariosArray.length === 0) {
    console.log("-> No valid scenarios to execute (they might be empty or marked as 'skip').");
    return;
  }

  console.log(`\n=== Generating & Executing Playwright Scripts in Batches of 3 for ${targetScenariosArray.length} Scenarios ===`);
  console.log(`-> [Parallel] Batches run with max 2 concurrent AI calls to stay within rate limits.`);

  const htmlContent = fileService.getLayoutHtml(safeName);
  const domContext = htmlContent ? `\n\nReference HTML DOM:\n${fileService.trimDomForPrompt(htmlContent, 3000)}` : "";

  // ── Concurrency limiter — max 2 parallel AI calls ──────────────────────────
  const MAX_PARALLEL = 2;
  const BATCH_SIZE   = 3; // smaller batches = more reliable JSON + fewer token errors

  const batches = [];
  for (let i = 0; i < targetScenariosArray.length; i += BATCH_SIZE) {
    batches.push({ batch: targetScenariosArray.slice(i, i + BATCH_SIZE), batchNumber: Math.floor(i / BATCH_SIZE) + 1, startIdx: i });
  }

  // Process batches in parallel groups of MAX_PARALLEL
  for (let g = 0; g < batches.length; g += MAX_PARALLEL) {
    const group = batches.slice(g, g + MAX_PARALLEL);
    console.log(`\n-> [Parallel] Processing batch group ${Math.floor(g / MAX_PARALLEL) + 1}: batches ${group.map(b => b.batchNumber).join(', ')}`);

    const groupResults = await Promise.allSettled(group.map(({ batch, batchNumber, startIdx }) =>
      _generateOneBatch({ batch, batchNumber, startIdx, safeName, url, domContext, memoryPath, htmlContent })
    ));

    // Log any failures
    groupResults.forEach((result, idx) => {
      if (result.status === 'rejected') {
        console.error(`-> [Parallel] Batch ${group[idx].batchNumber} failed: ${result.reason?.message}`);
      }
    });
  }

  console.log("-> [Test Executor] All batched scenarios have been generated and executed successfully.");
}

/**
 * Generates and executes a single batch — extracted so it can run in parallel.
 */
async function _generateOneBatch({ batch, batchNumber, startIdx, safeName, url, domContext, memoryPath, htmlContent }) {
    const shortName = safeName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
    const pageClassName = `${shortName}Batch${batchNumber}Page`;
    const verificationClassName = `${shortName}Batch${batchNumber}Verif`;
    const verificationFileName = `${shortName}_B${batchNumber}_Verif.js`;
    const pageFileName = `${shortName}_B${batchNumber}Page.js`;

    console.log(`\n--- Batch ${batchNumber} (${batch.length} scenarios: ${startIdx + 1}-${startIdx + batch.length}) ---`);

    let masterCode = `import { test, expect } from '@playwright/test';
import { ${pageClassName} } from '../../pages/${pageFileName}';
const fs = require('fs');
const path = require('path');
const scenariosFilePath = "${memoryPath.replace(/\\/g, "\\\\")}";
const targetUrl = "${url}";

function categorizeError(msg) {
    if (!msg) return 'unknown';
    const m = msg.toLowerCase();
    if (m.includes('waiting for locator') || m.includes('no element matches') || m.includes('strict mode')) return 'selector_not_found';
    if (m.includes('timeout') || m.includes('exceeded') || m.includes('timed out')) return 'timeout';
    if (m.includes('captcha') || m.includes('decrypt')) return 'captcha_failed';
    if (m.includes('navigation') || m.includes('net::err') || m.includes('page.goto')) return 'navigation_error';
    if (m.includes('expect') || m.includes('tohaveurl') || m.includes('tobevisible')) return 'assertion_failed';
    return 'unknown';
}

function updateScenarioStatus(scenarioId, status, remarks) {
    try {
        let scenarios = JSON.parse(fs.readFileSync(scenariosFilePath, "utf8"));
        let scenario = scenarios.find(s => s.scenarioId === scenarioId);
        if (scenario) {
            scenario.Status = status;
            scenario.executedDate = new Date().toISOString();
            if (remarks) scenario.remarks = remarks;
            if (status === 'Fail') scenario.errorCategory = categorizeError(remarks);
            const tmpPath = scenariosFilePath + '.tmp_' + process.pid + '_' + Date.now();
            fs.writeFileSync(tmpPath, JSON.stringify(scenarios, null, 2));
            fs.renameSync(tmpPath, scenariosFilePath);
        }
    } catch(e) {}
}

test.afterEach(async ({ }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
        const scenarioIdMatch = testInfo.title.match(/^(TC-AUTO-\\d+|TC-\\w+)/);
        if (scenarioIdMatch) {
            const errMsg = testInfo.error ? testInfo.error.message : 'Playwright assertion failed';
            updateScenarioStatus(scenarioIdMatch[1], 'Fail', errMsg);
        }
    }
});

test.describe('AI Generated Batch ${batchNumber}', () => {
`;

    // ── Split batch into positive and negative scenarios ─────────────────────
    // Negative scenarios need a different prompt — they expect errors, not success
    const negativeSignals = [
        'invalid', 'incorrect', 'wrong', 'empty', 'missing', 'error',
        'fail', 'fails', 'failure', 'exceed', 'blocked', 'rejected', 'reject',
        'blocked when', 'is blocked', 'submission is blocked', 'submission fails',
        'stale', 'incomplete', 'without selecting', 'without entering',
        'left empty', 'left blank', 'outside allowed', 'exceeds', 'duplicate',
        'incompatible', 'unauthorized', 'restricted', 'special character'
    ];
    const isNegative = (s) => negativeSignals.some(sig => (s.scenario || '').toLowerCase().includes(sig));

    const positiveBatch = batch.filter(s => !isNegative(s));
    const negativeBatch = batch.filter(s => isNegative(s));

    console.log(`   Positive: ${positiveBatch.length} | Negative: ${negativeBatch.length}`);

    // ── Generate Code using CodeAgent ────────────────────────────────────────
    const codeAgent = await getCodeAgent();
    
    // Re-extract metadata for structured AI context
    const DomMetadataExtractor = require('../Scenario_Creation/DomMetadataExtractor');
    const metadata = DomMetadataExtractor.extract(htmlContent || "");

    try {
        const aiResult = await codeAgent.generateCode({
            scenario: { batch, batchNumber }, // Send the whole batch
            metadata: metadata,
            pageName: pageClassName,
            url: url
        });

        if (aiResult.verificationCode) aiResult.verificationCode = aiResult.verificationCode.replace(/\\n/g, '\n');
        if (aiResult.pageCode) aiResult.pageCode = aiResult.pageCode.replace(/\\n/g, '\n');
        if (aiResult.testCode) aiResult.testCode = aiResult.testCode.replace(/\\n/g, '\n');

        fileService.saveVerificationFile(safeName, batchNumber, verificationClassName, aiResult.verificationCode);
        fileService.savePageFile(safeName, batchNumber, pageClassName, aiResult.pageCode);
        masterCode += aiResult.testCode + "\n";
    } catch (err) {
        console.error(`-> [Batch ${batchNumber}] Generation failed: ${err.message}`);
    }

    masterCode += `\n});\n`;

    const testFilePath = fileService.saveTestBatch(safeName, batchNumber, masterCode);
    console.log(`-> [Batch ${batchNumber}] Script saved: ${testFilePath}`);

    try {
        const relativeTestPath = path.relative(process.cwd(), testFilePath).replace(/\\/g, '/');
        execSync(`npx playwright test "${relativeTestPath}"`, { stdio: "inherit" });
    } catch (e) {
        console.error(`-> [Batch ${batchNumber}] Execution completed with failures.`);
    }

    // Self-healing
    const updatedScenarios = fileService.readScenarios(memoryPath);
    const failedScenarios = updatedScenarios.filter(s => s.Status === 'Fail' && s.remarks && !s.remarks.includes('Automatically repaired'));
    if (failedScenarios.length > 0) {
        console.log(`-> [Self-Healing] ${failedScenarios.length} failed in batch ${batchNumber}. Repairing...`);
        for (const failedScenario of failedScenarios) {
            await selfHealScenario(failedScenario, url, htmlContent, memoryPath);
        }
    }
}

async function generateSingleExecutableScript(targetUrl, scenariosToAutomate, selectedFile) {
  console.log("\n-> [Code Gen] Asking AI to write the Playwright test script...");

  const safeName = selectedFile.replace('_scenarios.json', '');
  const shortName = safeName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
  const pageClassName = `${shortName}ManualPage`;
  const verificationClassName = `${shortName}ManualVerif`;

  // Get metadata (we need a browser to get fresh metadata for the current URL)
  let metadata = { inputs: [], dropdowns: [], validations: [], pageInfo: { title: safeName, url: targetUrl } };
  try {
      const page = await browserService.init();
      await page.goto(targetUrl, { waitUntil: 'networkidle' });
      const htmlContent = await page.content();
      const DomMetadataExtractor = require('../Scenario_Creation/DomMetadataExtractor');
      metadata = DomMetadataExtractor.extract(htmlContent);
      await browserService.quit();
  } catch (e) {
      console.warn("-> [Code Gen] Could not extract fresh metadata, proceeding with basic context.");
  }

  const codeAgent = await getCodeAgent();
  try {
      const aiResult = await codeAgent.generateCode({
          scenario: scenariosToAutomate,
          metadata: metadata,
          pageName: pageClassName,
          url: targetUrl
      });

      if (aiResult.verificationCode) aiResult.verificationCode = aiResult.verificationCode.replace(/\\n/g, '\n');
      if (aiResult.pageCode) aiResult.pageCode = aiResult.pageCode.replace(/\\n/g, '\n');
      if (aiResult.testCode) aiResult.testCode = aiResult.testCode.replace(/\\n/g, '\n');

      const shortSelected = selectedFile.replace('_scenarios.json', '').substring(0, 20);
      let testFileName = `${shortSelected}_test_${Date.now()}.spec.js`;
      
      fileService.saveVerificationFile(safeName, 'Manual', verificationClassName, aiResult.verificationCode);
      fileService.savePageFile(safeName, 'Manual', pageClassName, aiResult.pageCode);
      const testFilePath = fileService.saveCustomTest(testFileName, aiResult.testCode);
      
      console.log(`-> [Code Gen] Test successfully generated and written to: ${testFilePath}\n`);
      return testFilePath;
  } catch (err) {
      console.error(`-> [Code Gen] Generation failed: ${err.message}`);
      throw err;
  }
}

async function startInteractiveRecorder(url, safeName) {
  return new Promise(async (resolve) => {
    try {
      console.log(`\n-> [Recorder] Starting Interactive Hybrid Session for: ${url}`);
      
      // 1. Launch Browser
      const page = await browserService.init();
      
      // 2. Start a fresh session so this journey is isolated from previous recordings
      queueProcessor.startSession(safeName);

      // 3. Inject Listener
      await recorder.injectSpy(page, safeName);

      // 3. URL Change Listener (Must be before Navigation to catch the first page)
      page.on('framenavigated', async (frame) => {
          if (frame === page.mainFrame()) {
              const newUrl = page.url();
              console.log(`\n-> [Event] URL Changed to: ${newUrl}`);

              // Update active page reference IMMEDIATELY (no wait)
              recorder._activePage = page;
              
              // Re-inject spy script IMMEDIATELY (no wait)
              await recorder.reinjectSpyOnCurrentPage(page, safeName);

              // Background Processing: Don't block the user's next action
              (async () => {
                  // Wait for initial stabilization (1s is enough for most modern apps)
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  
                  // Double check: Is the page still on the expected URL?
                  // If the user moved on already, skip this capture to avoid context crashes.
                  if (page.isClosed() || page.url() !== frame.url()) {
                      console.log(`-> [AutomationManager] Skipping capture: Page moved on or closed during 1s wait.`);
                      return;
                  }

                  // Capture DOM and Add to Queue
                  try {
                      const state = await recorder.handleNavigation(page, safeName);
                      if (state) {
                          queueProcessor.addToQueue({
                              url: state.url,
                              stepName: state.stepName,
                              safeName: safeName
                          });
                      }
                  } catch (e) {
                      console.warn(`-> [AutomationManager] Navigation capture skipped: ${e.message}`);
                  }
              })();
          }
      });

      // 4. Navigate to URL
      await browserService.navigateTo(url);
      
      console.log(`\n======================================================`);
      console.log(`|           INTERACTIVE RECORDING ACTIVE             |`);
      console.log(`|----------------------------------------------------|`);
      console.log(`| 1. Perform your actions in the browser window.     |`);
      console.log(`| 2. Framework is capturing inputs & URL changes.    |`);
      console.log(`| 3. Automation will generate AUTOMATICALLY.         |`);
      console.log(`| 4. Close the browser window when finished.         |`);
      console.log(`======================================================\n`);

      // Auto-Trigger Watcher
      let isFlowGenerated = false;
      const autoWatcher = setInterval(async () => {
          const idleTime = Date.now() - recorder.lastActivityTime;
          if (idleTime > 60000) {
              console.log(`\n-> [Timeout] 60s inactivity detected. Finalizing session...`);
              clearInterval(autoWatcher);
              isFlowGenerated = true;

              const shouldAutoGenerate = process.env.AUTO_GENERATE_CODE !== 'false';
              const isJ2PEnabled = process.env.J2P !== 'false';
              if (shouldAutoGenerate || isJ2PEnabled) {
                  await flowGenerator.generateHybridFlow(safeName);
              } else {
                  console.log("-> [Flag] AUTO_GENERATE_CODE and J2P are OFF. Skipping all generation.");
              }
              await page.close();
          }
      }, 5000);

      // Resolve the promise when session is fully done
      page.on('close', async () => {
          console.log(`\n-> [Recorder] Browser closed. Finalizing session...`);
          clearInterval(autoWatcher);
          recorder.stopActionServer();

          if (!isFlowGenerated) {
              isFlowGenerated = true;
              const shouldAutoGenerate = process.env.AUTO_GENERATE_CODE !== 'false';
              const isJ2PEnabled = process.env.J2P !== 'false';
              if (shouldAutoGenerate || isJ2PEnabled) {
                  await flowGenerator.generateHybridFlow(safeName);
              } else {
                  console.log("-> [Flag] AUTO_GENERATE_CODE and J2P are OFF. Skipping all generation.");
              }
          }

          // ── Wait for Background Tasks ──────────────────────────────────────
          // Ensure that even if the browser is closed, we wait for the AI Queue
          // to finish all pending extractions/generations before showing the menu.
          const queueProcessor = require('../services/QueueProcessor');
          if (queueProcessor.isProcessing || queueProcessor.queue.length > 0) {
              console.log("\n-> [Queue] Waiting for background AI tasks to complete...");
              await queueProcessor.waitForCompletion();
              console.log("-> [Queue] All background tasks finished.");
          }

          resolve();
      });

    } catch (e) {
      console.error("-> [Recorder Error]:", e.message);
      resolve(); // Always resolve so menu doesn't hang
    }
  });
}

async function selfHealScenario(scenario, targetUrl, htmlContent, scenariosFilePath) {
  console.log(`\n-> [Self-Healing] Analyzing failure for: ${scenario.scenarioId}...`);
  
  const DomMetadataExtractor = require('../Scenario_Creation/DomMetadataExtractor');
  const metadata = DomMetadataExtractor.extract(htmlContent || "");
  const codeAgent = await getCodeAgent();

  try {
    const aiResult = await codeAgent.generateCode({
        scenario: scenario,
        metadata: metadata,
        pageName: `${scenario.scenarioId.replace(/-/g, '')}HealedPage`,
        url: targetUrl,
        error: scenario.remarks
    });

    if (aiResult.verificationCode) aiResult.verificationCode = aiResult.verificationCode.replace(/\\n/g, '\n');
    if (aiResult.pageCode) aiResult.pageCode = aiResult.pageCode.replace(/\\n/g, '\n');
    if (aiResult.testCode) aiResult.testCode = aiResult.testCode.replace(/\\n/g, '\n');

    const healFileName = `heal_${scenario.scenarioId}_${Date.now()}.spec.js`;
    const safeName = scenario.scenarioId.replace(/[^a-zA-Z0-9]/g, '_');
    
    fileService.saveVerificationFile(safeName, 'Heal', 'HealedVerif', aiResult.verificationCode);
    fileService.savePageFile(safeName, 'Heal', 'HealedPage', aiResult.pageCode);
    const testFilePath = fileService.saveCustomTest(healFileName, aiResult.testCode);

    console.log(`-> [Self-Healing] AI successfully rewrote the script. Re-executing repaired script...`);
    const relativeHealPath = path.relative(process.cwd(), healFilePath).replace(/\\/g, '/');
    
    let healPassed = false;
    try {
      execSync(`npx playwright test "${relativeHealPath}"`, { stdio: "inherit" });
      healPassed = true;
    } catch (execErr) {
      console.error(`-> [Self-Healing] Healed script execution failed:`, execErr.message);
    }
    
    if (healPassed) {
      console.log(`-> [Self-Healing] SUCCESS! ${scenario.scenarioId} has been healed and passed.`);
      const scenarios = fileService.readScenarios(scenariosFilePath);
      const sIndex = scenarios.findIndex(s => s.scenarioId === scenario.scenarioId);
      if (sIndex !== -1) {
        scenarios[sIndex].Status = 'Pass (Healed)';
        scenarios[sIndex].remarks = 'Automatically repaired by AI';
        fileService.saveScenarios(scenariosFilePath, scenarios);
      }
    } else {
      console.error(`-> [Self-Healing] FAILED to heal ${scenario.scenarioId}. Error persists.`);
    }
  } catch (err) {
    console.error(`-> [Self-Healing] FAILED to heal ${scenario.scenarioId}. Error persists:`, err.message);
  }
}

module.exports = {
  setTestMode,
  extractAndGenerateScenarios,
  executeTestsNatively,
  generateSingleExecutableScript,
  startInteractiveRecorder,
  getScenarioAgent,
  closeScenarioAgent
};
