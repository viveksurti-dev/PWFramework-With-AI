
import { test, expect } from '@playwright/test';
import { PracticetestautomationcomPage } from '../pages/PracticetestautomationcomPage.js';
import { PracticetestautomationcomVerif } from '../verification/PracticetestautomationcomVerif.js';
import { CommonMethods } from '../pages/CommonMethods.js';
import { CommonVerifications } from '../verification/CommonVerifications.js';
const fs = require('fs');
const path = require('path');

const scenariosFilePath = "C:\\Users\\HP\\Downloads\\PWFramework-With-AI-main\\scenarios\\practicetestautomation.com_practice_test_login_scenarios.json";

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
        fs.writeFileSync(scenariosFilePath, JSON.stringify(scenarios, null, 2));
    } catch(e) {}
}

test.afterEach(async ({ }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
        const scenarioIdMatch = testInfo.title.match(/^(TC-(?:AUTO|HYBRID)-\d+)/);
        if (scenarioIdMatch) {
            updateScenarioStatus(scenarioIdMatch[1], 'Fail', testInfo.error ? testInfo.error.message : 'Failed');
        }
    }
});

const userInputs = {
  username: 'student',
  password: 'Password123'
};

test('TC-AUTO-1: To verify user can successfully log in with valid credentials', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verif = new PracticetestautomationcomVerif(page);

  await pageObj.navigateToLogin();
  await pageObj.fillUsername(userInputs.username);
  await pageObj.fillPassword(userInputs.password);
  await pageObj.clickSubmit();
  await verif.verifyLoginSuccess();

  await pageObj.clickPractice();
  await verif.verifyPracticePage();

  await pageObj.clickTestTable();
  await verif.verifyTestTablePage();

  await pageObj.clickContact();
  await verif.verifyContactPage();
});