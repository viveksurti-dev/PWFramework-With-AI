const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const { execSync } = require("child_process");
const path = require("path");

// Load environment variables

const fs = require("fs");
const dotenv = require("dotenv");
const envPath = fs.existsSync(path.join(__dirname, ".env")) 
    ? path.join(__dirname, ".env") 
    : path.join(__dirname, "..", ".env");
dotenv.config({ path: envPath });

const fileService = require("./utils/services/FileHandler");
const automationController = require("./config/AutomationManager");

// API Key Validation
const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
const openAiKey = (process.env.OPENAI_API_KEY || process.env.CHATGPT_API_KEY || "").trim();

if (!geminiKey && !openAiKey) {
  console.error("\n ERROR: Please add your GEMINI_API_KEY or OPENAI_API_KEY to the .env file.");
  process.exit(1);
}

async function runCliMenu() {
  const rl = readline.createInterface({ input, output });

  while (true) {
    console.log("\n==================================");
    console.log("     AI E2E AUTOMATION MENU     ");
    console.log("==================================");
    console.log("1. e2e Flow (Extract UI + Automate ALL scenarios natively)");
    console.log("2. create scenarios (Extract UI & Generate JSON only)");
    console.log("3. Execute scenarios by automation (Select manually)");
    console.log("4. failed scenarios execution (update status in json)");
    console.log("5. not tested scenarios execute");
    console.log("6. Export Scenarios to Excel (.xlsx)");
    console.log("7. Generator Menu (Generate single script for selected scenarios)");
    console.log("8. Regenerate Hybrid Flow from Saved Session");
    console.log("0. quit");
    console.log("==================================");

    const choice = await rl.question("\nEnter your choice (0-8): ");

    if (choice === "0") {
      console.log("\nGoodbye!");
      break;
    }

    if (choice === "7") {
        await generatorMenu(rl);
        continue;
    }

    let url = "";
    let safeName = "";
    let memoryPath = "";
    let memoryList = [];

    // Helper to get URL and SafeName
    async function getUrlInput() {
      const inputUrl = await rl.question("\nEnter the target URL (e.g., https://example.com): ");
      if (!inputUrl) return null;
      
      const urlObj = new URL(inputUrl);
      let name = urlObj.hostname + urlObj.pathname.replace(/[^a-zA-Z0-9]/g, "_");
      if (name.endsWith("_")) name = name.slice(0, -1);
      return { url: inputUrl, safeName: name || "home_page" };
    }

    switch (choice) {
      case "1":
        // Give SubMenu
        console.log("\n--- e2e Flow Sub-Menu ---");
        console.log("1. Unit Testing (Single Page analysis)");
        console.log("2. Integration Testing (Multi-Page)");
        const subChoice = await rl.question("\nSelect mode (1 or 2): ");

        const urlInfo = await getUrlInput();
        if (!urlInfo) {
          console.log("URL is required.");
          break;
        }
        url = urlInfo.url;
        safeName = urlInfo.safeName;
        memoryPath = fileService.getMemoryPath(safeName);

        if (subChoice === "1") {
          console.log("\n-> Starting Unit Testing mode...");
          await automationController.extractAndGenerateScenarios(url, safeName);
          memoryList = fileService.readScenarios(memoryPath);
          if (memoryList.length > 0) {
            const proceed = await rl.question(`\n[PAUSE] Found ${memoryList.length} scenarios. Review them in scenarios/ folder if needed.\ny -> continue for automation and n -> safely abort: `);
            if (proceed.toLowerCase().trim() !== 'y') {
              console.log("-> Aborted. You can execute them later using Option 3, 4, or 5.");
              break;
            }
            console.log(`\n=== Generating Master automation file... ===`);
            await automationController.executeTestsNatively(url, safeName, memoryList);
          }
        } else if (subChoice === "2") {
          console.log("\n-> Starting Integration Testing (Interactive Recorder) mode...");
          await automationController.startInteractiveRecorder(url, safeName);
        } else {
          console.log("Invalid selection.");
        }
        break;

      case "2":
        const urlInfo2 = await getUrlInput();
        if (urlInfo2) await automationController.extractAndGenerateScenarios(urlInfo2.url, urlInfo2.safeName);
        break;

      case "3":
        const urlInfo3 = await getUrlInput();
        if (!urlInfo3) break;
        url = urlInfo3.url;
        safeName = urlInfo3.safeName;
        memoryPath = fileService.getMemoryPath(safeName);

        memoryList = fileService.readScenarios(memoryPath);
        if (memoryList.length === 0) {
          console.log("No scenarios in memory. Please use option 1 or 2 first.");
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

      case "4":
        const urlInfo4 = await getUrlInput();
        if (!urlInfo4) break;
        url = urlInfo4.url;
        safeName = urlInfo4.safeName;
        memoryPath = fileService.getMemoryPath(safeName);

        memoryList = fileService.readScenarios(memoryPath);
        if (memoryList.length === 0) {
          console.log("No scenarios found.");
          break;
        }
        const failList = memoryList.filter((s) => String(s.Status).toLowerCase() === "fail");
        if (failList.length === 0) {
          console.log("No failed scenarios found!");
          break;
        }
        console.log(`Found ${failList.length} failed scenarios. Generating single execution file...`);
        await automationController.executeTestsNatively(url, safeName, failList);
        break;

      case "5":
        const urlInfo5 = await getUrlInput();
        if (!urlInfo5) break;
        url = urlInfo5.url;
        safeName = urlInfo5.safeName;
        memoryPath = fileService.getMemoryPath(safeName);

        memoryList = fileService.readScenarios(memoryPath);
        if (memoryList.length === 0) {
          console.log("No scenarios found.");
          break;
        }
        const notTestedList = memoryList.filter((s) => String(s.Status).toLowerCase() === "not tested");
        if (notTestedList.length === 0) {
          console.log("No 'not tested' scenarios found! (All done!)");
          break;
        }
        console.log(`Found ${notTestedList.length} untested scenarios. Generating single execution file...`);
        await automationController.executeTestsNatively(url, safeName, notTestedList);
        break;

      case "6":
        const urlInfo6 = await getUrlInput();
        if (!urlInfo6) break;
        url = urlInfo6.url;
        safeName = urlInfo6.safeName;
        memoryPath = fileService.getMemoryPath(safeName);

        memoryList = fileService.readScenarios(memoryPath);
        if (memoryList.length === 0) {
          console.log("Memory is empty or not found.");
          break;
        }
        const excelName = await rl.question("\nEnter filename for Excel export (e.g. login_scenarios): ");
        if (!excelName) {
          console.log("Filename required.");
          break;
        }
        try {
          const safeExcelName = excelName.replace(".xlsx", "");
          const path = fileService.exportToExcel(memoryList, safeExcelName);
          console.log(`\nSuccessfully exported scenarios to ${path}`);
        } catch (e) {
          console.log("Failed to export Excel document: " + e.message);
        }
        break;

      case "8":
        await regenerateHybridMenu(rl);
        break;

      default:
        console.log("Invalid choice.");
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
        const flowGenerator = require("./utils/services/FlowGenerator");
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

// Auto-run the CLI menu
runCliMenu().catch(console.error);

module.exports = {
  runCliMenu
};
