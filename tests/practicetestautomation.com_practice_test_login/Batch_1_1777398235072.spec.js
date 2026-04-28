import { test, expect } from '@playwright/test';
import { practicetestautomationcompracticetestloginBatch1Page } from '../../pages/practicetestautomation.com_practice_test_login_Batch_1Page.js';
const fs = require('fs');
const path = require('path');
const scenariosFilePath = "E:\\Multi Framework\\PWFramework\\PWFramework\\memory\\practicetestautomation.com_practice_test_login_scenarios.json";
const targetUrl = "https://practicetestautomation.com/practice-test-login/";

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
        const scenarioIdMatch = testInfo.title.match(/^(TC-AUTO-\d+|TC-\w+)/);
        if (scenarioIdMatch) {
            updateScenarioStatus(scenarioIdMatch[1], 'Fail', testInfo.error ? testInfo.error.message : 'Playwright assertion failed');
        }
    }
});

test.describe('AI Generated Batch 1', () => {
test("@AI TC-AUTO-1: To verify successful login with valid username and password.", async ({ page }) => {
    const targetUrl = 'https://practicetestautomation.com/practice-test-login/';
    await page.goto(targetUrl);
    console.log(`Navigation: Navigated to ${targetUrl}`);

    const pageObj = new practicetestautomationcompracticetestloginBatch1Page(page);
    await pageObj.login("student", "Password123");
    await pageObj.verifyLoginSuccess("https://practicetestautomation.com/logged-in-successfully/", "Logged In Successfully", "Log out");
    console.log(' Test completed successfully');
    updateScenarioStatus("TC-AUTO-1", "Pass", "Success");
});

test("@AI TC-AUTO-2: To verify login attempt with an invalid username and a valid password.", async ({ page }) => {
    const targetUrl = 'https://practicetestautomation.com/practice-test-login/';
    await page.goto(targetUrl);
    console.log(`Navigation: Navigated to ${targetUrl}`);

    const pageObj = new practicetestautomationcompracticetestloginBatch1Page(page);
    await pageObj.login("incorrectUser", "Password123");
    await pageObj.verifyLoginFailure();
    console.log(' Test completed successfully');
    updateScenarioStatus("TC-AUTO-2", "Pass", "Success");
});

test("@AI TC-AUTO-3: To verify login attempt with a valid username and an invalid password.", async ({ page }) => {
    const targetUrl = 'https://practicetestautomation.com/practice-test-login/';
    await page.goto(targetUrl);
    console.log(`Navigation: Navigated to ${targetUrl}`);

    const pageObj = new practicetestautomationcompracticetestloginBatch1Page(page);
    await pageObj.login("student", "incorrectPassword");
    await pageObj.verifyLoginFailure();
    console.log(' Test completed successfully');
    updateScenarioStatus("TC-AUTO-3", "Pass", "Success");
});

test("@AI TC-AUTO-4: To verify login attempt with both invalid username and invalid password.", async ({ page }) => {
    const targetUrl = 'https://practicetestautomation.com/practice-test-login/';
    await page.goto(targetUrl);
    console.log(`Navigation: Navigated to ${targetUrl}`);

    const pageObj = new practicetestautomationcompracticetestloginBatch1Page(page);
    await pageObj.login("nonExistentUser", "wrongPassword");
    await pageObj.verifyLoginFailure();
    console.log(' Test completed successfully');
    updateScenarioStatus("TC-AUTO-4", "Pass", "Success");
});

test("@AI TC-AUTO-5: To verify login attempt with an empty username field and a valid password.", async ({ page }) => {
    const targetUrl = 'https://practicetestautomation.com/practice-test-login/';
    await page.goto(targetUrl);
    console.log(`Navigation: Navigated to ${targetUrl}`);

    const pageObj = new practicetestautomationcompracticetestloginBatch1Page(page);
    await pageObj.login("", "Password123");
    await pageObj.verifyLoginFailure();
    console.log(' Test completed successfully');
    updateScenarioStatus("TC-AUTO-5", "Pass", "Success");
});

});
