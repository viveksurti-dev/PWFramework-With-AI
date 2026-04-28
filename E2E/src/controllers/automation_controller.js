const { execSync } = require("child_process");
const path = require("path");
const aiService = require("../services/ai_service");
const browserService = require("../services/browser_service");
const fileService = require("../services/file_service");

async function extractAndGenerateScenarios(url, safeName) {
  try {
    await browserService.init();
    await browserService.navigateTo(url);
    const { cleanHtml, encodedString } = await browserService.extractDOMAndScreenshot();
    // close browser
    await browserService.quit();
    
    fileService.saveLayout(safeName, cleanHtml, encodedString);
    
    const memoryPath = fileService.getMemoryPath(safeName);
    let existingScenarios = fileService.readScenarios(memoryPath);
    let existingPromptContext = "";

    if (existingScenarios.length > 0) {
      console.log(`-> [Memory] Found ${existingScenarios.length} existing scenarios for this page.`);
      const existingTitles = existingScenarios.map((s) => s.scenario).slice(0, 30);
      existingPromptContext = `\n\nCRITICAL CONTEXT: We already have ${existingScenarios.length} scenarios. DO NOT REPEAT ANY of the following scenarios:
${JSON.stringify(existingTitles, null, 2)}

Please strictly analyze the visible page layout and generate completely new, missing scenarios. If no critical new scenarios exist, reply strictly with an empty array: []`;
    }

    const testEnvData = fileService.readTestEnvironmentData();
    let dataContext = "";
    if (Object.keys(testEnvData).length > 0) {
      console.log(`-> [Data] Injected valid environment test data into prompt.`);
      dataContext = `\n\nTEST ENVIRONMENT DATA:\nWe have the following valid test data available for you to use:\n${JSON.stringify(testEnvData, null, 2)}\n\nCRITICAL INSTRUCTION FOR DATA-DRIVEN TESTING:\nWhen generating POSITIVE test scenarios (like successful logins, valid form submissions, etc.), you MUST explicitly use the values provided in this test data. Map this exact data directly into the "testData" field of your JSON output!`;
    }

    // find scenarios
    console.log("-> [AI] Finding Missing Scenarios...");
    const safeHtml = typeof cleanHtml === "string" ? cleanHtml.substring(0, 5000) : "No HTML extracted";

    const prompt = `You are an expert QA Automation Engineer. Analyze the attached screenshot of the web page and its cleaned HTML structure.
Generate all possible unique and meaningful test scenarios for this page covering positive, negative, and edge cases. DO NOT generate UI related scenarios (like screen layout, colors, fonts). CRITICAL: DO NOT create similar or redundant scenarios. Every scenario must test a distinct logical path or business rule. Avoid exhaustive minor variations (e.g., don't generate 50 scenarios for different lengths of invalid passwords).${existingPromptContext}${dataContext}

Cleaned HTML: 
${safeHtml}

IMPORTANT: Reply ONLY with a valid JSON array of new test scenarios. Do not include markdown formatting (like \`\`\`json).
Output MUST be 100% valid JSON. Do not include trailing commas.

CRITICAL INSTRUCTIONS:
- Every "scenario" value MUST start exactly with "To verify ".
- Every "expectedResult" value MUST start exactly with "Should be ".

Write the scenarios in this exact format:
{
  "scenarioId": "Unique ID (e.g., TC-001)",
  "module": "Identify the module (e.g., Auth, Login)",
  "createdAt": "Current Date",
  "createdBy": "AI Automation Generator",
  "scenario": "To verify [Detailed description...]",
  "expectedResult": "Should be [What should happen...]",
  "testData": "Any specific data to use",
  "executedDate": "",
  "executedBy": "",
  "Status": "not tested",
  "remarks": "NA"
}`;

    const responseText = await aiService.callAIWithFallback(prompt, encodedString);

    console.log("-> [Memory] Parsing AI response and updating Memory...");
    try {
      const match = responseText.match(/\[[\s\S]*\]/);
      let cleanJsonStr = match ? match[0] : responseText;
      cleanJsonStr = cleanJsonStr.replace(/(,)(\s*[}\]])/g, "$2");

      let newScenarios = JSON.parse(cleanJsonStr);
      if (newScenarios.length > 0) {
        const currentIdCount = existingScenarios.length;
        newScenarios.forEach((s, idx) => {
          s.scenarioId = `TC-AUTO-${currentIdCount + idx + 1}`;
        });
        existingScenarios = existingScenarios.concat(newScenarios);
        fileService.saveScenarios(memoryPath, existingScenarios);
        console.log(`-> [Memory] Successfully appended ${newScenarios.length} NEW scenarios. Total: ${existingScenarios.length}`);
      } else {
        console.log(`-> [Memory] No new scenarios were found. Total remains: ${existingScenarios.length}`);
      }
    } catch (e) {
      console.error("-> [Memory Error] Failed to parse JSON from AI.", e.message);
    }
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

  console.log(`\n=== Generating & Executing Playwright Scripts in Batches of 5 for ${targetScenariosArray.length} Scenarios ===`);

  const htmlContent = fileService.getLayoutHtml(safeName);
  const domContext = htmlContent ? `\n\nReference HTML DOM:\n${htmlContent.substring(0, 15000)}` : "";

  for (let i = 0; i < targetScenariosArray.length; i += 5) {
    const batch = targetScenariosArray.slice(i, i + 5);
    const batchNumber = Math.floor(i / 5) + 1;
    console.log(`\n--- Processing Batch ${batchNumber} (${batch.length} Scenarios: ${i + 1} to ${i + batch.length}) ---`);

    const pageClassName = `${safeName.replace(/[^a-zA-Z0-9]/g, '')}Batch${batchNumber}Page`;
    const verificationClassName = `${safeName.replace(/[^a-zA-Z0-9]/g, '')}Batch${batchNumber}Verification`;
    const verificationFileName = `${safeName}_Batch_${batchNumber}_Verification.js`;
    const pageFileName = `${safeName}_Batch_${batchNumber}Page.js`;

    let masterCode = `import { test, expect } from '@playwright/test';
import { ${pageClassName} } from '../../pages/${pageFileName}';
const fs = require('fs');
const path = require('path');
const scenariosFilePath = "${memoryPath.replace(/\\/g, "\\\\")}";
const targetUrl = "${url}";

function updateScenarioStatus(scenarioId, status, remarks) {
    try {
        let scenarios = JSON.parse(fs.readFileSync(scenariosFilePath, "utf8"));
        let scenario = scenarios.find(s => s.scenarioId === scenarioId);
        if (scenario) {
            scenario.Status = status;
            scenario.executedDate = new Date().toISOString();
            if (remarks) scenario.remarks = remarks;
            fs.writeFileSync(scenariosFilePath, JSON.stringify(scenarios, null, 2));
        }
    } catch(e) {}
}

test.afterEach(async ({ }, testInfo) => {
    // If the test failed, we record the error in memory
    if (testInfo.status !== testInfo.expectedStatus) {
        const scenarioIdMatch = testInfo.title.match(/^(TC-AUTO-\\d+|TC-\\w+)/);
        if (scenarioIdMatch) {
            updateScenarioStatus(scenarioIdMatch[1], 'Fail', testInfo.error ? testInfo.error.message : 'Playwright assertion failed');
        }
    }
});

test.describe('AI Generated Batch ${batchNumber}', () => {
`;

    const codePrompt = `You are an expert QA Automation Engineer. Generate Playwright POM architecture code for ${batch.length} test scenarios.
IMPORTANT: You MUST return a strictly valid JSON object with EXACTLY three properties: "pageCode", "verificationCode", and "testCode". DO NOT return any markdown formatting outside the JSON.
CRITICAL JSON FORMATTING: The values for these three properties will be large multi-line strings of JavaScript code. You MUST properly escape all double quotes (\\"), newlines (\\n), and backslashes (\\\\) inside the strings to ensure the JSON is 100% valid.

Scenarios to Automate:
${JSON.stringify(batch, null, 2)}${domContext}

Requirements for "PWFramework Style":
1. "verificationCode": A class named ${verificationClassName}. It must require expect: \`const { expect } = require('@playwright/test');\`. Define locators in the constructor (e.g. \`this.page = page;\` and \`this.locator = page.locator(...);\`). Export using CommonJS: \`module.exports = { ${verificationClassName} };\`.
2. "pageCode": An ES Module exporting a class named ${pageClassName} that extends BasePage. 
   - It MUST import BasePage at the top: \`import { BasePage } from './BasePage.js';\`
   - If required, import resources from utils at the top: \`import { CommonMethods } from '../utils/CommonMethods.js';\`
   - DO NOT import the verification class at the top. Instead, require it dynamically INSIDE your verification methods like this:
     \`const { ${verificationClassName} } = require('../verification/${verificationFileName}');\`
     \`const verification = new ${verificationClassName}(this.page);\`
     \`await verification.yourAssertionMethod();\`
   - Define locators in the constructor using \`this.page = page;\` and \`super(page);\`.
3. "testCode": ONLY the 'test("@AI TC-XXX: description", async ({ page }) => { ... })' blocks.
   - DO NOT import anything here. I prepend imports automatically.
   - Just instantiate the page class: \`const pageObj = new ${pageClassName}(page);\`
   - Call high-level methods on pageObj. No raw locators or expect() here.
4. Use structured logging (e.g. console.log(' Test completed successfully');)
5. Inside each test, start with: \`await page.goto(targetUrl);\`
6. For test data, HARDCODE the exact values from the injected TEST ENVIRONMENT DATA directly into the method calls.
7. At the very end of each test block, add this line EXACTLY: updateScenarioStatus("TC-XXX", "Pass", "Success");
8. CRITICAL: For negative/error scenarios, DO NOT assert on the exact error message text (e.g. avoid expect().toHaveText('Exact String')), as actual error texts often vary. Instead, simply verify that the error element is visible (e.g. expect(locator).toBeVisible()), ensuring the invalid action was successfully blocked.
9. CRITICAL: NEVER inject custom fixtures. The test signature MUST be exactly \`async ({ page }) =>\`. Do NOT put \`testData\` or \`updateScenarioStatus\` inside the destructured arguments.
10. CRITICAL: Write PLAIN JavaScript ONLY. DO NOT use TypeScript syntax (no \`private\`, \`readonly\`, or type annotations).
`;

    try {
      console.log("-> [Code Gen] Asking AI to generate Playwright POM scripts for this batch...");
      let responseText = await aiService.callAIWithFallback(codePrompt);
      responseText = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
      const aiResult = JSON.parse(responseText);

      // Fix double-escaped newlines from AI
      if (aiResult.verificationCode) aiResult.verificationCode = aiResult.verificationCode.replace(/\\n/g, '\n');
      if (aiResult.pageCode) aiResult.pageCode = aiResult.pageCode.replace(/\\n/g, '\n');
      if (aiResult.testCode) aiResult.testCode = aiResult.testCode.replace(/\\n/g, '\n');

      fileService.saveVerificationFile(safeName, batchNumber, verificationClassName, aiResult.verificationCode);
      fileService.savePageFile(safeName, batchNumber, pageClassName, aiResult.pageCode);
      masterCode += aiResult.testCode + "\n";
    } catch (err) {
      console.error("-> [Generation Error] Failed to generate code chunk or parse JSON:", err.message);
    }

    masterCode += `\n});\n`; // close describe

    const testFilePath = fileService.saveTestBatch(safeName, batchNumber, masterCode);
    console.log(`-> [Code Gen] Batch script saved to: ${testFilePath}`);
    console.log(`=================== EXECUTING BATCH ${batchNumber} ===================`);
    
    try {
      const relativeTestPath = path.relative(process.cwd(), testFilePath).replace(/\\/g, '/');
      execSync(`npx playwright test "${relativeTestPath}"`, { stdio: "inherit" });
    } catch (e) {
      console.error(`-> [Execution Warning] Batch ${batchNumber} completed with failures.`);
    }
    console.log(`=================================================================\n`);
    
    const memoryPathForHealing = fileService.getMemoryPath(safeName);
    const updatedScenarios = fileService.readScenarios(memoryPathForHealing);
    const failedScenarios = updatedScenarios.filter(s => s.Status === 'Fail' && s.remarks && !s.remarks.includes('Automatically repaired'));

    if (failedScenarios.length > 0) {
      console.log(`\n-> [Self-Healing] Detected ${failedScenarios.length} failed test(s) in this batch. Initiating AI Auto-Repair...`);
      for (const failedScenario of failedScenarios) {
        await selfHealScenario(failedScenario, targetUrl, htmlContent, memoryPathForHealing);
      }
    }
  }

  console.log("-> [Test Executor] All batched scenarios have been generated and executed successfully.");
}

async function generateSingleExecutableScript(targetUrl, scenariosToAutomate, selectedFile) {
  console.log("\n-> [Code Gen] Asking AI to write the Playwright test script...");

  const safeName = selectedFile.replace('_scenarios.json', '');
  const pageClassName = `${safeName.replace(/[^a-zA-Z0-9]/g, '')}ManualPage`;
  const verificationClassName = `${safeName.replace(/[^a-zA-Z0-9]/g, '')}ManualVerification`;
  const verificationFileName = `${safeName}_Manual_Verification.js`;
  const pageFileName = `${safeName}_ManualPage.js`;

  const codePrompt = `You are an expert QA Automation Engineer. Generate Playwright POM architecture code for the following scenarios.
IMPORTANT: You MUST return a strictly valid JSON object with EXACTLY three properties: "pageCode", "verificationCode", and "testCode". DO NOT return any markdown formatting outside the JSON.
CRITICAL JSON FORMATTING: The values for these three properties will be large multi-line strings of JavaScript code. You MUST properly escape all double quotes (\\"), newlines (\\n), and backslashes (\\\\) inside the strings to ensure the JSON is 100% valid.

Scenarios:
${JSON.stringify(scenariosToAutomate, null, 2)}

Requirements for PWFramework Style:
1. "verificationCode": A class named ${verificationClassName}. It must require expect: \`const { expect } = require('@playwright/test');\`. Define locators in the constructor (e.g. \`this.page = page;\` and \`this.locator = page.locator(...);\`). Export using CommonJS: \`module.exports = { ${verificationClassName} };\`.
2. "pageCode": An ES Module exporting a class named ${pageClassName} that extends BasePage. 
   - It MUST import BasePage at the top: \`import { BasePage } from './BasePage.js';\`
   - If required, import resources from utils at the top: \`import { CommonMethods } from '../utils/CommonMethods.js';\`
   - DO NOT import the verification class at the top. Instead, require it dynamically INSIDE your verification methods like this:
     \`const { ${verificationClassName} } = require('../verification/${verificationFileName}');\`
     \`const verification = new ${verificationClassName}(this.page);\`
     \`await verification.yourAssertionMethod();\`
   - Define locators in the constructor using \`this.page = page;\` and \`super(page);\`.
3. "testCode": a complete, executable Playwright test script (.spec.js format).
   - In "testCode", import the page class: \`import { ${pageClassName} } from '../pages/${pageFileName}';\`
   - Import test from '@playwright/test'.
   - Just instantiate the page class: \`const pageObj = new ${pageClassName}(page);\`
   - Call high-level methods on pageObj. No raw locators or expect() here.
4. Use structured logging (e.g. console.log('✅ Test completed successfully');)
5. Inside each test, start with: \`await page.goto('${targetUrl}');\`
6. For test data, HARDCODE the exact values from the injected TEST ENVIRONMENT DATA directly into the method calls.
7. CRITICAL: For negative/error scenarios, DO NOT assert on the exact error message text (e.g. avoid expect().toHaveText('Exact String')), as actual error texts often vary. Instead, simply verify that the error element is visible (e.g. expect(locator).toBeVisible()), ensuring the invalid action was successfully blocked.
8. CRITICAL: NEVER inject custom fixtures. The test signature MUST be exactly \`async ({ page }) =>\`. Do NOT put \`testData\` inside the destructured arguments.
9. CRITICAL: Write PLAIN JavaScript ONLY. DO NOT use TypeScript syntax (no \`private\`, \`readonly\`, or type annotations).
`;

  console.log("-> [Code Gen] Asking AI to write the POM scripts...");
  let responseText = await aiService.callAIWithFallback(codePrompt);
  responseText = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
  const aiResult = JSON.parse(responseText);

  // Fix double-escaped newlines from AI
  if (aiResult.verificationCode) aiResult.verificationCode = aiResult.verificationCode.replace(/\\n/g, '\n');
  if (aiResult.pageCode) aiResult.pageCode = aiResult.pageCode.replace(/\\n/g, '\n');
  if (aiResult.testCode) aiResult.testCode = aiResult.testCode.replace(/\\n/g, '\n');

  let testFileName = selectedFile.replace('_scenarios.json', `_test_${Date.now()}.spec.js`);
  
  fileService.saveVerificationFile(safeName, 'Manual', verificationClassName, aiResult.verificationCode);
  fileService.savePageFile(safeName, 'Manual', pageClassName, aiResult.pageCode);
  const testFilePath = fileService.saveCustomTest(testFileName, aiResult.testCode);
  
  console.log(`-> [Code Gen] Test successfully generated and written to: ${testFilePath}\n`);
  return testFilePath;
}

async function selfHealScenario(scenario, targetUrl, htmlContent, scenariosFilePath) {
  console.log(`\n-> [Self-Healing] Analyzing failure for: ${scenario.scenarioId}...`);
  
  const domContext = htmlContent ? `\n\nReference HTML DOM:\n${htmlContent.substring(0, 15000)}` : "";
  const healPrompt = `You are an expert QA Automation Auto-Healer. 
The following Playwright test scenario failed during execution.

Scenario: ${scenario.scenario}
Target URL: ${targetUrl}

CRASH ERROR TRACE:
${scenario.remarks}

Your task is to rewrite the Playwright test block 'test("${scenario.scenarioId}: ...", async ({ page }) => { ... })' to fix the issue. The failure is likely due to a changed selector, incorrect wait condition, or broken logic. Analyze the provided DOM carefully to find the correct elements.

Requirements:
1. Start the test with 'await page.goto(targetUrl);'.
2. Use Playwright locator strategies (page.locator, page.getByText, etc.) and 'expect()'.
3. Do NOT include markdown wrappers (like \`\`\`javascript). Just the raw test block.
4. Call 'updateScenarioStatus("${scenario.scenarioId}", "Pass (Healed)", "Automatically repaired by AI");' at the end of the test.
${domContext}`;

  try {
    let healedCode = await aiService.callAIWithFallback(healPrompt);
    healedCode = healedCode.replace(/```javascript/gi, "").replace(/```js/gi, "").replace(/```/g, "").trim();

    // Wrap the healed block in a complete script
    const fullHealedScript = `const { test, expect } = require('@playwright/test');
const fs = require('fs');
const targetUrl = "${targetUrl}";
const scenariosFilePath = "${scenariosFilePath.replace(/\\/g, "\\\\")}";

function updateScenarioStatus(scenarioId, status, remarks) {
    try {
        let scenarios = JSON.parse(fs.readFileSync(scenariosFilePath, "utf8"));
        let scenario = scenarios.find(s => s.scenarioId === scenarioId);
        if (scenario) {
            scenario.Status = status;
            scenario.executedDate = new Date().toISOString();
            if (remarks) scenario.remarks = remarks;
            fs.writeFileSync(scenariosFilePath, JSON.stringify(scenarios, null, 2));
        }
    } catch(e) {}
}

${healedCode}
`;

    const healFileName = `heal_${scenario.scenarioId}_${Date.now()}.spec.js`;
    const healFilePath = fileService.saveCustomTest(healFileName, fullHealedScript);

    console.log(`-> [Self-Healing] AI successfully rewrote the script. Re-executing repaired script...`);
    const relativeHealPath = path.relative(process.cwd(), healFilePath).replace(/\\/g, '/');
    execSync(`npx playwright test "${relativeHealPath}"`, { stdio: "inherit" });
    
    console.log(`-> [Self-Healing] SUCCESS! ${scenario.scenarioId} has been healed and passed.`);
    
    const scenarios = fileService.readScenarios(scenariosFilePath);
    const sIndex = scenarios.findIndex(s => s.scenarioId === scenario.scenarioId);
    if (sIndex !== -1) {
      scenarios[sIndex].Status = 'Pass (Healed)';
      scenarios[sIndex].remarks = 'Automatically repaired by AI';
      fileService.saveScenarios(scenariosFilePath, scenarios);
    }
  } catch (err) {
    console.error(`-> [Self-Healing] FAILED to heal ${scenario.scenarioId}. Error persists:`, err.message);
  }
}

module.exports = {
  extractAndGenerateScenarios,
  executeTestsNatively,
  generateSingleExecutableScript
};
