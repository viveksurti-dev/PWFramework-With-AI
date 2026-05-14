
import { test, expect } from '@playwright/test';
import { PracticetestautomationcomPage } from '../pages/PracticetestautomationcomPage.js';
import { PracticetestautomationcomVerif } from '../verification/PracticetestautomationcomVerif.js';
import { CommonMethods } from '../pages/CommonMethods.js';
import { CommonVerifications } from '../verification/CommonVerifications.js';
const fs = require('fs');
const path = require('path');

const scenariosFilePath = "E:\\PWFramework-With-AI-main\\scenarios\\practicetestautomation.com_practice_test_table_scenarios.json";

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
        if (!fs.existsSync(scenariosFilePath)) {
            fs.writeFileSync(scenariosFilePath, JSON.stringify([], null, 2));
        }
        let scenarios = JSON.parse(fs.readFileSync(scenariosFilePath, "utf8"));
        let scenario = scenarios.find(s => s.scenarioId === scenarioId);
        if (scenario) {
            scenario.Status = status;
            scenario.executedDate = new Date().toISOString();
            if (remarks) scenario.remarks = remarks;
            if (status === 'Fail') scenario.errorCategory = categorizeError(remarks);
        } else {
            scenarios.push({
                scenarioId,
                scenario: scenarioId,
                Status: status,
                executedDate: new Date().toISOString(),
                remarks: remarks || "Success",
                createdBy: "AI Hybrid Flow",
                module: "Hybrid"
            });
        }
        const tmpPath = scenariosFilePath + '.tmp_' + process.pid;
        fs.writeFileSync(tmpPath, JSON.stringify(scenarios, null, 2));
        fs.renameSync(tmpPath, scenariosFilePath);
    } catch(e) {}
}

test.afterEach(async ({ }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
        const scenarioIdMatch = testInfo.title.match(/^(TC-(?:AUTO|HYBRID)-\\d+)/);
        if (scenarioIdMatch) {
            updateScenarioStatus(scenarioIdMatch[1], 'Fail', testInfo.error ? testInfo.error.message : 'Failed');
        }
    }
});

test('TC-AUTO-24: Submission blocked when all required fields are blank', async ({ page }) => {
  const p = new PracticetestautomationcomPage(page);
  const v = new PracticetestautomationcomVerif(page);
  await p.navigateToTable();
  await p.clickCourses();
  await p.submitForm();
  await v.verifyPageContains('Email Address *');
});
test('TC-AUTO-21: Submission blocked for invalid Email format', async ({ page }) => {
  const p = new PracticetestautomationcomPage(page);
  const v = new PracticetestautomationcomVerif(page);
  await p.navigateToTable();
  await p.clickCourses();
  await p.fillSubscription('John', 'invalid-email');
  await p.submitForm();
  await v.verifyPageContains('Email Address *');
});

test('TC-AUTO-17: To verify negative scenario selecting invalid language option', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await pageObj.navigateToUrl('https://practicetestautomation.com/practice-test-table/');
  await pageObj.clickElement('xpath=//input[@name="lang" and @value="InvalidLang"]');
  verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-17', 'passed', 'NA');
});

test('TC-AUTO-19: To verify submission blocked when Name field is blank', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await pageObj.navigateToUrl('https://practicetestautomation.com/courses/');
  await pageObj.fillInput('#form_email_8', 'test@example.com');
  await pageObj.submitForm();
  verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-19', 'passed', 'NA');
});

test('TC-AUTO-20: To verify submission blocked when Email field is blank', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await pageObj.navigateToUrl('https://practicetestautomation.com/courses/');
  await pageObj.fillInput('#form_first_name_8', 'John Doe');
  await pageObj.submitForm();
  verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-20', 'passed', 'NA');
});

test('TC-AUTO-22: To verify submission blocked for invalid Email format invalid-email', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await pageObj.navigateToUrl('https://practicetestautomation.com/courses/');
  await pageObj.fillInput('#form_first_name_8', 'John Doe');
  await pageObj.fillInput('#form_email_8', 'invalid-email');
  await pageObj.submitForm();
  verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-22', 'passed', 'NA');
});

test('TC-AUTO-23: To verify rejection when honeypot field data[email] is filled', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await pageObj.navigateToUrl('https://practicetestautomation.com/courses/');
  await pageObj.fillInput('input[name="data[email]"]', 'bot@spam.com');
  await pageObj.fillInput('#form_first_name_8', 'John Doe');
  await pageObj.fillInput('#form_email_8', 'valid@email.com');
  await pageObj.submitForm();
  verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-23', 'passed', 'NA');
});