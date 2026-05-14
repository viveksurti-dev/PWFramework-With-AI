const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const { execSync } = require("child_process");
const path = require("path");

// Load environment variables

const fs = require("fs");
const dotenv = require("dotenv");
// Load from root directory
const envPath = path.join(process.cwd(), ".env");
dotenv.config({ path: envPath });

const fileService = require("../services/FileHandler");
const automationController = require("./AutomationManager");
const aiService = require("../services/AiEngine");

// API Key Validation
const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
const geminiKeys = [...new Set(geminiKey.split(',').map(k => k.trim()).filter(k => k))];
const geminiKeyCount = geminiKeys.length;
const openAiKey = (process.env.OPENAI_API_KEY || process.env.CHATGPT_API_KEY || "").trim();

if (!geminiKey && !openAiKey) {
  console.error("\n ERROR: Please add your GEMINI_API_KEY or OPENAI_API_KEY to the .env file.");
  process.exit(1);
}

// ── Global test mode — set once at startup, used by all generation calls ──────
// 'unit'  → PromptBuilder_Unit    (single-page analysis)
// 'e2e'   → PromptBuilder_EndToEnd (full multi-page journey)
let TEST_MODE = 'unit'; // default

async function selectTestMode(rl) {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║     SELECT TEST GENERATION MODE      ║");
  console.log("╠══════════════════════════════════════╣");
  console.log("║  1. Unit Testing                     ║");
  console.log("║     Single page analysis             ║");
  console.log("║     Scenarios for ONE page at a time ║");
  console.log("║                                      ║");
  console.log("║  2. End-to-End Testing               ║");
  console.log("║     Full multi-page journey          ║");
  console.log("║     Scenarios across ALL pages       ║");
  console.log("╚══════════════════════════════════════╝");

  while (true) {
    const modeChoice = await rl.question("\nSelect mode (1 = Unit, 2 = End-to-End): ");
    if (modeChoice.trim() === '1') {
      TEST_MODE = 'unit';
      console.log("\n-> Mode set: UNIT TESTING (single-page scenarios)");
      break;
    } else if (modeChoice.trim() === '2') {
      TEST_MODE = 'e2e';
      console.log("\n-> Mode set: END-TO-END TESTING (full journey scenarios)");
      break;
    } else {
      console.log("Please enter 1 or 2.");
    }
  }

  // Pass the selected mode to AutomationManager so it uses the right prompt builder
  automationController.setTestMode(TEST_MODE);
}

async function runCliMenu() {
  const rl = readline.createInterface({ input, output });

  // Preflight: verify at least one AI model is reachable
  const activeModel = await aiService.preflight();
  if (!activeModel) {
    console.error("\n ERROR: No AI models are reachable. Please check your API keys.");
    rl.close();
    process.exit(1);
  }
  console.log(`\n-> [Ready] Using: ${activeModel.model} (${activeModel.provider})\n`);

  // Ask user to select test mode
  await selectTestMode(rl);

  while (true) {
    console.log("\n==================================");
    console.log(`     AI E2E AUTOMATION MENU [${TEST_MODE.toUpperCase()} MODE]     `);
    console.log("==================================");
    console.log("1. Start Recording (Run Flow)");
    console.log("2. Run Existing Scenarios (Select manually)");
    console.log("3. Export Scenarios to Excel (.xlsx)");
    console.log("4. Advanced Script Generator");
    console.log("5. Regenerate from Saved Session");
    console.log("0. Quit");
    console.log("==================================");

    let choice = "";
    try {
      choice = await rl.question("\nEnter your choice (0-5): ");
    } catch (rlErr) {
      // If readline closed unexpectedly (e.g. after process interrupt), recreate it
      console.log("-> [Interface] Restoring menu interface...");
      return runCliMenu(); 
    }

    if (choice === "0") {
      console.log("\nGoodbye!");
      rl.close();
      process.exit(0);
    }

    if (choice === "4") {
      await generatorMenu(rl);
      continue;
    }
    
    if (choice === "5") {
      await buildFromJourneyMenu(rl);
      continue;
    }

    let url = "";
    let safeName = "";
    let memoryPath = "";
    let memoryList = [];

    // Helper to get URL and SafeName
    const getUrlInput = async () => {
      const inputUrl = await rl.question("\nEnter the target URL (e.g., https://example.com): ");
      if (!inputUrl) return null;
      
      const urlObj = new URL(inputUrl);
      let name = urlObj.hostname + urlObj.pathname.replace(/[^a-zA-Z0-9]/g, "_");
      if (name.endsWith("_")) name = name.slice(0, -1);
      return { url: inputUrl, safeName: name || "home_page" };
    }

    switch (choice) {
      case "1":
        console.log(`\n-> Running in ${TEST_MODE === 'e2e' ? 'END-TO-END' : 'UNIT'} mode (selected at startup)`);
        const urlInfo = await getUrlInput();
        if (!urlInfo) {
          console.log("URL is required.");
          break;
        }
        url = urlInfo.url;
        safeName = urlInfo.safeName;

        if (TEST_MODE === 'unit') {
          await automationController.extractAndGenerateScenarios(url, safeName);
          memoryPath = fileService.getMemoryPath(safeName);
          memoryList = fileService.readScenarios(memoryPath);
          if (memoryList.length > 0) {
            const proceed = await rl.question(`\nGenerated ${memoryList.length} scenarios. Execute automation now? (y/n): `);
            if (proceed.toLowerCase().trim() !== 'y') {
              console.log("-> Aborted. You can execute them later using Option 2.");
              break;
            }
            console.log(`\n=== Generating Master automation file... ===`);
            await automationController.executeTestsNatively(url, safeName, memoryList);
          }
        } else {
          console.log("\n-> Starting Interactive Recorder...");
          await automationController.startInteractiveRecorder(url, safeName);
        }
        break;

      case "2":
        const urlInfo2 = await getUrlInput();
        if (!urlInfo2) break;
        url = urlInfo2.url;
        safeName = urlInfo2.safeName;
        memoryPath = fileService.getMemoryPath(safeName);

        memoryList = fileService.readScenarios(memoryPath);
        if (memoryList.length === 0) {
          console.log("No scenarios in memory. Please use option 1 first.");
          break;
        }
        console.log(`\nAvailable Scenarios (${memoryList.length}):`);
        memoryList.forEach((s, i) =>
          console.log(`[${i + 1}] [${s.Status}] ${String(s.scenario).substring(0, 60)}...`)
        );

        const pickStr = await rl.question(`\nSelect scenario [1-${memoryList.length}]: `);
        const pick = parseInt(pickStr) - 1;
        if (!isNaN(pick) && memoryList[pick]) {
          await automationController.executeTestsNatively(url, safeName, [memoryList[pick]]);
        } else {
          console.log("Invalid selection.");
        }
        break;

      case "3":
        const urlInfo3 = await getUrlInput();
        if (!urlInfo3) break;
        url = urlInfo3.url;
        safeName = urlInfo3.safeName;
        memoryPath = fileService.getMemoryPath(safeName);

        memoryList = fileService.readScenarios(memoryPath);
        if (memoryList.length === 0) {
          console.log("Memory is empty or not found.");
          break;
        }
        const excelName = await rl.question("\nEnter filename for Excel export: ");
        if (!excelName) {
          console.log("Filename required.");
          break;
        }
        try {
          const safeExcelName = excelName.replace(".xlsx", "");
          const path = await fileService.exportToExcel(memoryList, safeExcelName);
          console.log(`\nSuccessfully exported scenarios to ${path}`);
        } catch (e) {
          console.log("Failed to export Excel document: " + e.message);
        }
        break;
      default:
        console.log("Invalid choice.");
        break;
    }
  }
  rl.close();
}

async function generatorMenu(rl) {
    console.log("\n=== AI E2E Automation - Generator Menu ===");
    const memoryFiles = fileService.getMemoryFiles();
    
    if (memoryFiles.length === 0) {
        console.error("No scenarios found in scenarios folder.");
        return;
    }

    console.log("\n-> Available Scenarios in scenarios folder:");
    memoryFiles.forEach((f, i) => console.log(`[${i + 1}]. ${f}`));
    
    const fileIndexStr = await rl.question("\nSelect a scenario file number to load (e.g., 1): ");
    const fileIndex = parseInt(fileIndexStr) - 1;
    
    if (isNaN(fileIndex) || !memoryFiles[fileIndex]) {
        console.log("Invalid selection. Returning to main menu.");
        return;
    }

    const selectedFile = memoryFiles[fileIndex];
    const memoryPath = path.join(fileService.scenariosDir, selectedFile);
    const scenarioData = fileService.readScenarios(memoryPath);
    
    console.log(`\nFound ${scenarioData.length} test scenarios inside ${selectedFile}:`);
    scenarioData.forEach((s, i) => {
        const preview = s.scenarioTitle || s.title || s.scenario || 'Scenario';
        console.log(`[${i + 1}] ${preview.length > 80 ? preview.substring(0, 80) + '...' : preview}`);
    });
    
    const secIndexStr = await rl.question("\nSelect a scenario number to generate & run (or type 'all' to build one big test suite): ");
    
    let scenariosToAutomate = [];
    if (secIndexStr.toLowerCase().trim() === 'all') {
        scenariosToAutomate = scenarioData;
    } else {
        const idx = parseInt(secIndexStr) - 1;
        if (!isNaN(idx) && scenarioData[idx]) {
            scenariosToAutomate = [scenarioData[idx]];
        } else {
            console.log("Invalid selection.");
            return;
        }
    }

    scenariosToAutomate = scenariosToAutomate.filter(s => String(s.Status).toLowerCase() !== 'skip');
    if (scenariosToAutomate.length === 0) {
        console.log("-> No valid scenarios to execute.");
        return;
    }

    const targetUrl = await rl.question("\nEnter the target URL for these scenarios (e.g. http://localhost/): ");

    try {
        const testFilePath = await automationController.generateSingleExecutableScript(targetUrl, scenariosToAutomate, selectedFile);
        
        const runExec = await rl.question("Execute this test script right now? (y/n): ");
        if (runExec.toLowerCase().trim() === 'y') {
            console.log(`\n=================== TEST EXECUTING ===================`);
            const { execSync } = require("child_process");
            try {
                execSync(`npx playwright test "${testFilePath}" --headed`, { stdio: 'inherit' });
            } catch (e) {
                console.log("\n-> [Test Executor] Execution finished or was interrupted.");
            }
            console.log(`======================================================`);
            console.log("\n-> [Test Executor] AI Test Suite Completed.");
        } else {
            console.log("\nTest generation complete. You can run the test manually anytime.");
        }
    } catch(e) {
        console.error("Failed to generate or execute test:", e);
    }
}

async function regenerateHybridMenu(rl) {
    console.log("\n=== AI E2E Automation - Regenerate Hybrid Flow ===");
    const memoryFiles = fileService.getMemoryFiles();
    
    if (memoryFiles.length === 0) {
        console.error("No recordings found.");
        return;
    }

    console.log("\n-> Select a recording to regenerate into a Full Journey Test:");
    memoryFiles.forEach((f, i) => console.log(`[${i + 1}]. ${f.replace('_scenarios.json', '')}`));
    
    const choiceStr = await rl.question("\nSelect a number (e.g., 1): ");
    const idx = parseInt(choiceStr) - 1;
    
    if (isNaN(idx) || !memoryFiles[idx]) {
        console.log("Invalid selection.");
        return;
    }

    const safeName = memoryFiles[idx].replace('_scenarios.json', '');
    console.log(`\n-> Regenerating Hybrid Flow for: ${safeName}...`);
    
    try {
        const flowGenerator = require("../services/FlowGenerator");
        const testFilePath = await flowGenerator.generateHybridFlow(safeName);
        
        if (testFilePath) {
            console.log(`\n-> SUCCESS! Hybrid Flow regenerated: ${testFilePath}`);
            const runNow = await rl.question("Run this test now? (y/n): ");
            if (runNow.toLowerCase().trim() === 'y') {
                const { execSync } = require("child_process");
                try {
                    execSync(`npx playwright test "${testFilePath}" --headed`, { stdio: 'inherit' });
                } catch (e) {
                    console.log("\n-> Execution finished.");
                }
            }
        }
    } catch (e) {
        console.error("Failed to regenerate Hybrid Flow:", e.message);
    }
}

async function buildFromJourneyMenu(rl) {
    console.log("\n=== Build Playwright Script from Recorded Journey (No AI) ===");

    const fs   = require('fs');
    const path = require('path');
    const queueDir  = path.join(__dirname, '..', '..', '..', 'test-results', 'queue');
    const queueFile = path.join(queueDir, 'queue_status.json');

    // Show available per-session files
    let sessions = [];
    if (fs.existsSync(queueDir)) {
        sessions = fs.readdirSync(queueDir)
            .filter(f => f.endsWith('_journey.json'))
            .map(f => f.replace('_journey.json', ''));
    }

    // Also offer the shared queue as an option if it exists
    const hasSharedQueue = fs.existsSync(queueFile);

    if (sessions.length === 0 && !hasSharedQueue) {
        console.log("\nNo recorded sessions found.");
        console.log("-> Record a session first using Option 1 (E2E mode).");
        console.log("-> After recording, Option 9 will list your sessions here.");
        return;
    }

    if (sessions.length > 0) {
        console.log("\nAvailable recorded sessions:");
        sessions.forEach((s, i) => console.log(`  [${i + 1}] ${s}`));
    }

    if (hasSharedQueue) {
        console.log(`  [${sessions.length + 1}] (last session — queue_status.json)`);
    }

    const pick = await rl.question("\nSelect session number: ");
    const idx  = parseInt(pick) - 1;

    let safeName;
    if (!isNaN(idx) && idx >= 0 && idx < sessions.length) {
        safeName = sessions[idx];
    } else if (hasSharedQueue && !isNaN(idx) && idx === sessions.length) {
        // User picked the shared queue fallback — derive safeName from first URL in journey
        try {
            const q = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
            const firstStep = (q.journey || []).find(s => s.url);
            if (firstStep) {
                const u = new URL(firstStep.url);
                safeName = (u.hostname + u.pathname)
                    .replace(/[^a-zA-Z0-9]/g, '_')
                    .replace(/_+/g, '_')
                    .replace(/^_|_$/g, '')
                    .substring(0, 60);
                console.log(`-> Using safeName derived from URL: ${safeName}`);
            }
        } catch (e) { /* ignore */ }
        if (!safeName) safeName = 'recorded_session';
    } else {
        console.log("Invalid selection.");
        return;
    }

    try {
        const j2p = require("../services/JourneyToPlaywright");
        const { pageFilePath, testFilePath } = await j2p.generate(safeName);

        console.log(`\n✅ Page class : ${pageFilePath}`);
        console.log(`✅ Test spec  : ${testFilePath}`);

        const runNow = await rl.question("\nRun this test now? (y/n): ");
        if (runNow.toLowerCase().trim() === 'y') {
            const { execSync } = require("child_process");
            console.log(`\n=================== EXECUTING ===================`);
            try {
                execSync(`npx playwright test "${testFilePath}" --headed`, { stdio: 'inherit' });
            } catch (e) {
                console.log("\n-> Execution finished (check results above).");
            }
            console.log(`=================================================`);
        }
    } catch (e) {
        console.error("-> [Build Error]:", e.message);
    }
}

// Auto-run the CLI menu
runCliMenu().catch(console.error);

module.exports = {
  runCliMenu
};
