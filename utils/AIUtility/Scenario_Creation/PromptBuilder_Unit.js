'use strict';

/**
 * PromptBuilder_Unit.js — AI prompt templates for UNIT (Single-Page) test generation.
 *
 * Prompts:
 * - buildUnitTestBatchPrompt()       → POM code generation for a batch of scenarios
 * - buildNegativeBatchPrompt()       → Batch negative tests for a single page
 * - buildScenarioExtractionPrompt()  → Extract test scenarios from a single page's DOM
 */

const shared = require('./PromptRules_Shared');

const PromptBuilder_Unit = {

    /**
     * Builds the prompt for batch POM code generation (single-page unit tests).
     * @param {object} params
     * @param {Array}  params.batch
     * @param {string} params.pageClassName
     * @param {string} params.verificationClassName
     * @param {string} params.verificationFileName
     * @param {string} params.domContext
     * @returns {string}
     */
    buildUnitTestBatchPrompt(params) {
        const { batch, pageClassName, verificationClassName, verificationFileName, domContext } = params;

        return `You are an expert QA Automation Engineer.
Generate Playwright POM code for ${batch.length} UNIT test scenarios (single page).

Return a strictly valid JSON object with exactly three properties: "pageCode", "verificationCode", "testCode".
Escape all double quotes, newlines, and backslashes in JSON string values.

Scenarios:
${JSON.stringify(batch, null, 2)}${domContext}

REQUIREMENTS:
1. "verificationCode": Class ${verificationClassName} extends CommonVerifications.
   Import: \`import { CommonVerifications } from '../verification/CommonVerifications.js';\`
   Constructor calls \`super(page);\`. Use inherited helpers. Add only scenario-specific methods.

2. "pageCode": Class ${pageClassName} extends CommonMethods.
   Import: \`import { CommonMethods } from '../pages/CommonMethods.js';\`
   Constructor calls \`super(page);\`. Use inherited helpers (fillInput, clickElement, navigateToUrl).
   Do not import verification class at top — require it dynamically inside methods.

3. "testCode": test blocks only (imports are prepended automatically).
   Instantiate: \`const pageObj = new ${pageClassName}(page);\`
   Call high-level methods. No raw locators or expect() in test code.
   Start each test: \`await page.goto(targetUrl);\`
   End each test: \`updateScenarioStatus("TC-XXX", "Pass", "Success");\`

4. For negative scenarios: verify error element is visible, do not assert exact text.
${shared.selectorRules()}
${shared.captchaRules()}`;
    },

    /**
     * Builds the batch negative scenario prompt for Unit mode.
     * @param {object} params
     * @param {Array}  params.batch
     * @param {string} params.pageClass
     * @param {string} params.verifClass
     * @param {string} params.startUrl
     * @param {string} params.domContext
     * @param {string} params.locatorsContext
     * @param {string} params.methodsContext
     * @param {string} params.verifMethodsContext
     * @returns {string}
     */
    buildNegativeBatchPrompt(params) {
        const { batch, pageClass, verifClass, startUrl, domContext,
                locatorsContext, methodsContext, verifMethodsContext } = params;

        return `Generate Playwright test code for ${batch.length} UNIT negative scenarios.
Return ONLY raw test blocks — no JSON wrapper, no markdown, no explanations.

Page Class: ${pageClass} | Verification Class: ${verifClass} | URL: ${startUrl}

SCENARIOS:
${JSON.stringify(batch, null, 2)}

CONTEXT:
${domContext.substring(0, 3000)}${locatorsContext}${methodsContext}${verifMethodsContext}

RULES:
1. Generate exactly ${batch.length} test blocks.
2. Format: test('SCENARIO_ID: description', async ({ page }) => { ... })
3. No apostrophes in titles.
4. Start each test:
   const pageObj = new ${pageClass}(page);
   const verifObj = new ${verifClass}(page);
   await page.goto('${startUrl}');
5. End each test: updateScenarioStatus('SCENARIO_ID', 'passed', 'NA');
6. Negative tests only — expect errors, not success.
7. Use verifObj.verifyErrorVisible() for error checks.
8. If a method has no parameters, use fillInput/clickElement directly for custom data.
9. Never call page.locator() directly.
${shared.captchaRules()}`;
    },

    /**
     * Builds the scenario extraction prompt for a single page.
     * @param {object} params
     * @param {string} params.safeHtml
     * @param {string} params.existingPromptContext
     * @param {string} params.dataContext
     * @returns {string}
     */
};

module.exports = PromptBuilder_Unit;
