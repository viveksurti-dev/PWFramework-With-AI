'use strict';

/**
 * PromptRules_Shared.js — Shared rule sections for Unit and E2E prompt builders.
 */

const SharedRules = {

    coreRules() {
        return `
CORE RULES:
1. No markdown, no code fences, no comments, no placeholders (...)
2. Return executable Playwright code only
3. ES6 modules: use import, never require() or CommonJS
4. Use expect from '@playwright/test'
5. STRING SAFETY: No apostrophes in test titles. Use "does not" not "doesn't", "cannot" not "can't". No possessives.
6. Named exports only (export class). Never "export default".
7. Plain JavaScript only. No TypeScript syntax.
8. Test signature must be exactly \`async ({ page }) =>\`. Never inject custom fixtures.`;
    },

    inheritanceRules(pageClass, verifClass) {
        return `
BASE CLASS INHERITANCE:
- ${pageClass} must extend CommonMethods. Import: \`import { CommonMethods } from '../pages/CommonMethods.js';\` Constructor calls \`super(page);\`
- ${verifClass} must extend CommonVerifications. Import: \`import { CommonVerifications } from '../verification/CommonVerifications.js';\` Constructor calls \`super(page);\`
- Do not duplicate or override base class methods.
- Never write \`async verifyErrorVisible() { await this.verifyErrorVisible(); }\` — infinite recursion.`;
    },

    selectorRules() {
        return `
LOCATOR PRIORITY — strictly follow this order (1 = most preferred):
  1. Playwright role-based  → page.getByRole('button', { name: 'Submit' })
  2. data-testid            → page.getByTestId('submit-btn')  or  [data-testid="submit-btn"]
  3. aria-label             → [aria-label="Submit"]  or  page.getByLabel('Submit')
  4. Placeholder / Label    → page.getByPlaceholder('Enter email')  or  [placeholder="Enter email"]
  5. Visible text           → page.getByText('Submit', { exact: true })
  6. CSS (stable only)      → #stable-id, [name="field"], tag[attr="val"]  — NO :nth-child/:nth-of-type
  7. XPath (fallback only)  → xpath=//button[normalize-space()='Submit']

RECORDED LOCATORS FORMAT: Each action now carries ranked strategy arrays:
  locators.playwright[]  — Playwright API calls, best-first (use these in generated code)
  locators.aria[]        — ARIA/testId CSS selectors
  locators.text[]        — text-based XPath expressions
  locators.cssList[]     — CSS selectors, stable-first
  locators.xpathList[]   — XPath expressions, stable-first

USAGE RULE: Always pick from locators.playwright[0] first. If empty, try aria[0], then text[0], then cssList[0], then xpathList[0].
NEVER use generic selectors like 'button', 'input', 'input[type=submit]' when a named/role/text locator is available.
NEVER invent selectors not present in RECORDED LOCATORS or DOM context.`;
    },

    captchaRules() {
        return `
CAPTCHA: If DOM has a captcha field (placeholder contains "captcha"/"verification code"), handle dynamically:
  const captchaPromise = Captcha.returnCaptcha(this.page, 'captcha/gen', 'encData');
  const captchaText = await captchaPromise;
  await this.fillInput('#captcha', captchaText);
Never hardcode a captcha value.`;
    },

    verificationRules() {
        return `
VERIFICATION: Never leave verification files empty. Every method called in testCode must exist in the verification file.
Use only: verifyURL(), verifyURLContains(), verifyErrorVisible(), verifyPageContains().
Prefer verifyURLContains(text) over regex. Never invent selectors not in the DOM.`;
    },

    cleanPageObjectRules() {
        return `
PAGE OBJECTS: Interaction methods must not contain waitForURL or expect(). All navigation waits and assertions go in verification methods.`;
    },

    scenarioTrackingRules() {
        return `
SCENARIO TRACKING: Every test title must start with a matching ID from Existing Scenarios (e.g., test('TC-AUTO-1: ...')).
End each test with: updateScenarioStatus('TC-AUTO-X', 'passed', 'NA');
Only create new 'TC-HYBRID-XXX' IDs if no matching TC-AUTO scenario exists.`;
    }
};

module.exports = SharedRules;
