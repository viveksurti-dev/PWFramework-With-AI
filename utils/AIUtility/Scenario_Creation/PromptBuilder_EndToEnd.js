'use strict';

/**
 * PromptBuilder_EndToEnd.js — AI prompt templates for END-TO-END (Integration) test generation.
 *
 * Prompts:
 * - buildHybridFlowPrompt()    → HappyPath + NegativeScenarios across the full journey
 * - buildNegativeBatchPrompt() → Batch negative tests distributed across all journey pages
 */

const shared = require('./PromptRules_Shared');

const PromptBuilder_EndToEnd = {

    /**
     * Builds the main E2E prompt for Hybrid Flow test generation.
     * @param {object} params
     * @param {string} params.flowName
     * @param {string} params.startUrl
     * @param {string} params.pageClass
     * @param {string} params.verifClass
     * @param {Array}  params.flowContext
     * @param {object} params.capturedData
     * @param {Array}  params.sanitizedLocators
     * @param {object} params.domMetadata      — structured metadata from DomMetadataExtractor (preferred)
     * @param {string} params.domContext        — raw DOM snippet fallback (500 chars per page)
     * @param {string} params.commonMethodsContext
     * @param {string} params.commonVerifContext
     * @param {Array}  params.existingScenarios
     * @returns {string}
     */
    buildHybridFlowPrompt(params) {
        const { flowName, startUrl, pageClass, verifClass, flowContext, capturedData,
                sanitizedLocators, domMetadata, domContext,
                commonMethodsContext, commonVerifContext,
                existingScenarios } = params;

        const uniquePages = [...new Set((flowContext || []).map(s => s.url).filter(Boolean))];
        const pageCount = uniquePages.length;

        // Detect any selectable-option interactions from the journey (framework-agnostic)
        const dropdownActions = (flowContext || []).filter(s =>
            s.type === 'click' && s.locators &&
            (
                // Native HTML
                s.locators.tagName === 'option' ||
                s.locators.tagName === 'select' ||
                // ARIA roles (React, Vue, Bootstrap, custom)
                (s.locators.ariaLabel || '').toLowerCase().includes('option') ||
                (s.locators.cssSelector || '').includes('[role="option"]') ||
                (s.locators.cssSelector || '').includes('[role="listbox"]') ||
                // Angular Material
                s.locators.tagName === 'mat-option' ||
                (s.locators.cssSelector || '').includes('mat-option') ||
                // Ant Design / MUI / Semantic UI
                (s.locators.cssSelector || '').includes('ant-select-item') ||
                (s.locators.cssSelector || '').includes('MuiMenuItem') ||
                (s.locators.cssSelector || '').includes('item') ||
                // Radio / checkbox
                s.locators.tagName === 'input' && (
                    (s.locators.cssSelector || '').includes('[type="radio"]') ||
                    (s.locators.cssSelector || '').includes('[type="checkbox"]')
                )
            )
        );
        const hasDropdowns = dropdownActions.length > 0;

        // ── Build context block: metadata (preferred) + raw DOM fallback ─────
        // Priority: domMetadata → raw domContext snippet
        // Metadata is 94% smaller than raw DOM and contains ALL structured info
        // the AI needs: fields, validations, dropdowns, radio options, dependencies.
        let contextBlock = '';

        if (domMetadata && domMetadata.pages && domMetadata.pages.length > 0) {
            contextBlock = `
METADATA CONTEXT (source of truth — extracted from live DOM, structured for deterministic scenario generation):
Use ONLY the fields, options, validations, and dependencies listed here.
Do NOT invent field names, option values, or validation rules not present in this metadata.
Do NOT parse raw HTML — this metadata IS the DOM, pre-processed for you.

${JSON.stringify(domMetadata, null, 2)}

METADATA USAGE RULES:
- inputs[]       → every text/email/number/date/textarea field on each page
- dropdowns[]    → every select/mat-select/combobox field (options may be empty for Angular runtime dropdowns — use recorded journey values for those)
- radioGroups[]  → every radio group with its exact option values (e.g. Yes/No, Male/Female)
- checkboxes[]   → every checkbox field
- validations[]  → exact rules per field (required, maxlength, pattern, min, max)
- dependencies[] → conditional sections and parent-child relationships — MUST generate scenarios for each
- conditionallyHidden:true → field only appears when its trigger condition is met — generate both "trigger active" and "trigger inactive" scenarios

SCENARIO GENERATION FROM METADATA:
1. HAPPY PATH — use every required field from inputs[], every radio group option, every dependency trigger
2. CROSS-FIELD COMBINATIONS — combine radioGroups options across multiple groups (e.g. Gender × Category × Relationship)
3. DEPENDENCY SCENARIOS — for each dependency in dependencies[]:
   - conditional-visibility: generate "section appears when trigger=Yes" AND "section hidden when trigger=No"
   - parent-child: generate "child loads after parent selected" AND "child resets when parent changes"
   - auto-population: generate "fields auto-fill" AND "auto-filled values are editable"
4. BOUNDARY SCENARIOS — use min/max values from validations[] (e.g. maxlength:10 → test with exactly 10 chars AND 11 chars)
5. NEGATIVE SCENARIOS — use pattern rules from validations[] to generate invalid format tests (PAN, mobile, email, pincode)
${domContext ? `\nRAW DOM FALLBACK (selector hints only — do not use for field discovery):\n${domContext}` : ''}`;
        } else {
            // No metadata available — fall back to raw DOM snippet
            contextBlock = `DOM Context:\n${domContext}`;
        }

        return `Generate STRICT VALID JSON ONLY.

Flow: ${flowName} | Start: ${startUrl} | Mode: END-TO-END INTEGRATION TEST

WHAT THIS TEST MUST DO:
Cover the ENTIRE flow across ${pageCount} page(s). Navigate through ALL pages visited.
This is an INTEGRATION test — do NOT generate single-page unit tests, field-level validation tests, or UI/layout tests.
Every test must navigate through MULTIPLE pages. Tests that only interact with one page are FORBIDDEN.

Pages visited (ALL must appear in every HappyPath test):
${uniquePages.map((u, i) => `  ${i + 1}. ${u}`).join('\n')}

HAPPY PATH PRIORITY — GENERATE THESE FIRST:
1. PRIMARY happy path — full journey using the EXACT recorded values below
${hasDropdowns ? `2. OPTION VARIANT happy paths — scan the DOM for ALL selectable elements:
   - Native: <select>/<option>, <input type="radio">, <input type="checkbox">
   - ARIA-based: role="option", role="listbox", role="combobox", role="radio", role="tab"
   - Framework dropdowns: any custom dropdown component (Angular Material, React Select, Ant Design, MUI, Bootstrap, etc.)
   For each major selectable field (Gender, Loan Type, Category, Status, Type, etc.), generate one additional happy path test using a DIFFERENT option value.
   Cover ALL available option values before writing any negative tests.
   Include the specific option value in the test title and testData.` : ''}
${hasDropdowns ? `3. NEGATIVE scenarios — only AFTER all happy path variants are covered` : '2. NEGATIVE scenarios — only after the primary happy path is covered'}

STRICT RULES — READ CAREFULLY:
- NEVER generate: "verify button is visible", "verify page loads", "verify field accepts input", "verify error message color", "verify placeholder text" — these are unit tests, NOT integration tests
- NEVER generate a test that only visits one page
- EVERY test must start at ${startUrl} and navigate through the full journey
- Negative tests must test JOURNEY-LEVEL failures (e.g. submitting the whole form with invalid data), NOT single-field validation

RECORDED DATA:
Journey Sequence (follow exactly for HappyPath):
${JSON.stringify(flowContext, null, 2)}

Captured Inputs (use exact values):
${JSON.stringify(capturedData, null, 2)}

RECORDED LOCATORS (highest priority — captured from live browser):
${sanitizedLocators.length > 0 ? JSON.stringify(sanitizedLocators, null, 2) : "None — use metadata context below."}

${contextBlock}${commonMethodsContext}${commonVerifContext}

Existing Scenario IDs (for ID tracking ONLY — do NOT copy their selectors or test logic):
${JSON.stringify(existingScenarios, null, 2)}

CRITICAL — CROSS-PAGE CONTAMINATION RULE:
These IDs come from ALL pages. DO NOT use their titles as a guide for what fields to interact with.
Use these IDs purely to assign matching TC-AUTO-X numbers to your generated tests.

RULES:
${shared.coreRules()}
${shared.inheritanceRules(pageClass, verifClass)}
${shared.selectorRules()}
${shared.captchaRules()}
${shared.verificationRules()}
${shared.cleanPageObjectRules()}
${shared.scenarioTrackingRules()}

E2E COMPLETENESS: HappyPath must include every step from the journey. Use only selectors from RECORDED LOCATORS. Follow journey order exactly.

NEGATIVE SCENARIOS: Generate 1 negative test per major page (not all for the first page). Each negative test must still navigate through multiple pages.
Example for [Login → Dashboard → Applications]: Test 1 = invalid login attempt, Test 2 = attempt to access dashboard without completing required steps, Test 3 = submit application with missing required fields.

OUTPUT FORMAT:
{
  "pageFiles": { "${pageClass}.js": "..." },
  "verificationFiles": { "${verifClass}.js": "..." },
  "testCode": { "HappyPath.spec.js": "...", "NegativeScenarios.spec.js": "..." }
}`;
    },

    /**
     * Builds the batch negative scenario prompt for E2E mode.
     * @param {object} params
     * @param {Array}  params.batch
     * @param {string} params.pageClass
     * @param {string} params.verifClass
     * @param {string} params.startUrl
     * @param {object} params.domMetadata      — structured metadata (preferred)
     * @param {string} params.domContext        — raw DOM fallback
     * @param {string} params.locatorsContext
     * @param {string} params.methodsContext
     * @param {string} params.verifMethodsContext
     * @returns {string}
     */
    buildNegativeBatchPrompt(params) {
        const { batch, pageClass, verifClass, startUrl,
                domMetadata, domContext,
                locatorsContext, methodsContext, verifMethodsContext } = params;

        const contextSection = domMetadata
            ? `METADATA CONTEXT (use as source of truth — do not parse raw HTML):\n${JSON.stringify(domMetadata, null, 2)}`
            : `DOM Context:\n${(domContext || '').substring(0, 3000)}`;

        return `Generate Playwright test code for ${batch.length} E2E negative scenarios.
Return ONLY raw test blocks — no JSON wrapper, no markdown, no explanations.

Page Class: ${pageClass} | Verification Class: ${verifClass} | Start URL: ${startUrl}

SCENARIOS (each targets a different page):
${JSON.stringify(batch, null, 2)}

CONTEXT:
${contextSection}${locatorsContext}${methodsContext}${verifMethodsContext}

RULES:
1. Generate exactly ${batch.length} test blocks.
2. Format: test('SCENARIO_ID: description', async ({ page }) => { ... })
3. No apostrophes in titles.
4. Start each test:
   const pageObj = new ${pageClass}(page);
   const verifObj = new ${verifClass}(page);
5. Navigate to the correct page for each scenario (not always startUrl).
6. End each test: updateScenarioStatus('SCENARIO_ID', 'passed', 'NA');
7. Negative tests only — expect errors, not success.
8. Use verifObj.verifyErrorVisible() for error checks.
9. If a method has no parameters, use fillInput/clickElement directly for custom data.
10. Never call page.locator() directly.
${shared.captchaRules()}`;
    },

    /**
     * E2E-specific scenario extraction — generic for ANY website.
     * Generates cross-field combination + dependency-aware integration scenarios.
     * Called by AutomationManager in E2E mode.
     */
};

module.exports = PromptBuilder_EndToEnd;
