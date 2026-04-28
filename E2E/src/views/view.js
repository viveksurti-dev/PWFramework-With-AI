const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const { execSync } = require("child_process");
const fileService = require("../services/file_service");
const automationController = require("../controllers/automation_controller");

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
    console.log("0. quit");
    console.log("==================================");

    const choice = await rl.question("\nEnter your choice (0-7): ");

    if (choice === "0") {
      console.log("\nGoodbye!");
      break;
    }

    if (choice === "7") {
        await generatorMenu(rl);
        continue;
    }

    const url = await rl.question("\nEnter the target URL (e.g., http://localhost/placementportal/auth/login.php): ");
    if (!url) {
      console.log("URL is required.");
      continue;
    }

    const urlObj = new URL(url);
    let safeName = urlObj.hostname + urlObj.pathname.replace(/[^a-zA-Z0-9]/g, "_");
    if (safeName.endsWith("_")) safeName = safeName.slice(0, -1);
    if (!safeName) safeName = "home_page";

    const memoryPath = fileService.getMemoryPath(safeName);
    let memoryList = [];

    switch (choice) {
      case "1":
        await automationController.extractAndGenerateScenarios(url, safeName);
        memoryList = fileService.readScenarios(memoryPath);
        if (memoryList.length > 0) {
          const proceed = await rl.question(`\n[PAUSE] Found ${memoryList.length} scenarios. Review them in memory/ folder if needed.\ny -> continue for automation and n -> safely abort: `);
          if (proceed.toLowerCase().trim() !== 'y') {
            console.log("-> Aborted. You can execute them later using Option 3, 4, or 5.");
            break;
          }
          console.log(`\n=== Generating ONE single Master automation file for EVERYTHING... ===`);
          await automationController.executeTestsNatively(url, safeName, memoryList);
        } else {
          console.log("\n-> No scenarios found in memory to execute.");
        }
        break;

      case "2":
        await automationController.extractAndGenerateScenarios(url, safeName);
        break;

      case "3":
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
        console.error("No scenarios found in memory.");
        return;
    }

    console.log("\n-> Available Scenarios in Memory:");
    memoryFiles.forEach((f, i) => console.log(`[${i + 1}]. ${f}`));
    
    const fileIndexStr = await rl.question("\nSelect a memory file number to load (e.g., 1): ");
    const fileIndex = parseInt(fileIndexStr) - 1;
    
    if (isNaN(fileIndex) || !memoryFiles[fileIndex]) {
        console.log("Invalid selection. Returning to main menu.");
        return;
    }

    const selectedFile = memoryFiles[fileIndex];
    const memoryPath = fileService.basePath + "/memory/" + selectedFile;
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
            execSync(`node "${testFilePath}"`, { stdio: 'inherit' });
            console.log(`======================================================`);
            console.log("\n-> [Test Executor] End-to-End Test Completed.");
        } else {
            console.log("\nTest generation complete. You can run the test manually anytime.");
        }
    } catch(e) {
        console.error("Failed to generate or execute test:", e);
    }
}

module.exports = {
  runCliMenu
};
