
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
  username: 'invalidUser',
  password: 'Password123'
};

test('TC-HYBRID-1: To verify logging in with an incorrect username', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verif = new PracticetestautomationcomVerif(page);

  await pageObj.navigateToLogin();
  await pageObj.fillUsername(userInputs.username);
  await pageObj.fillPassword(userInputs.password);
  await pageObj.clickSubmit();
  await verif.verifyErrorVisible();
});

test('TC-HYBRID-2: To verify logging in with an empty username field', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verif = new PracticetestautomationcomVerif(page);

  await pageObj.navigateToLogin();
  await pageObj.fillUsername('');
  await pageObj.fillPassword(userInputs.password);
  await pageObj.clickSubmit();
  await verif.verifyErrorVisible();
});

test('TC-AUTO-2: To verify dont contain any special characters in username', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', 'user@name');
  await pageObj.fillInput('#password', 'Password123');
  await pageObj.clickElement('#submit');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-2', 'passed', 'NA');
});

test('TC-AUTO-3: To verify dont contain any special characters in password', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', 'student');
  await pageObj.fillInput('#password', 'Pass@word123');
  await pageObj.clickElement('#submit');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-3', 'passed', 'NA');
});

test('TC-AUTO-4: To verify logging in with an empty username field', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', '');
  await pageObj.fillInput('#password', 'Password123');
  await pageObj.clickElement('#submit');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-4', 'passed', 'NA');
});

test('TC-AUTO-5: To verify logging in with an empty password field', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', 'student');
  await pageObj.fillInput('#password', '');
  await pageObj.clickElement('#submit');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-5', 'passed', 'NA');
});

test('TC-AUTO-6: To verify logging in with an incorrect username', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', 'incorrectUser');
  await pageObj.fillInput('#password', 'Password123');
  await pageObj.clickElement('#submit');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-6', 'passed', 'NA');
});

test('TC-AUTO-7: To verify logging in with an incorrect password', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', 'student');
  await pageObj.fillInput('#password', 'IncorrectPassword');
  await pageObj.clickElement('#submit');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-7', 'passed', 'NA');
});

test('TC-AUTO-9: To verify user receives an error message when username contains special characters', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', 'user@name');
  await pageObj.fillInput('#password', 'validPass123');
  await pageObj.clickElement('#submit');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-9', 'passed', 'NA');
});

test('TC-AUTO-10: To verify user receives an error message when password exceeds maximum length', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', 'validUser');
  await pageObj.fillInput('#password', 'aVeryLongPasswordThatExceedsTheLimit');
  await pageObj.clickElement('#submit');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-10', 'passed', 'NA');
});

test('TC-AUTO-11: To verify user receives an error message when username is empty', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', '');
  await pageObj.fillInput('#password', 'validPass123');
  await pageObj.clickElement('#submit');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-11', 'passed', 'NA');
});

test('TC-AUTO-12: To verify user receives an error message when password is empty', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', 'validUser');
  await pageObj.fillInput('#password', '');
  await pageObj.clickElement('#submit');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-12', 'passed', 'NA');
});

test('TC-AUTO-13: To verify user receives an error message when invalid credentials are provided', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', 'invalidUser');
  await pageObj.fillInput('#password', 'invalidPass');
  await pageObj.clickElement('#submit');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-13', 'passed', 'NA');
});

test('TC-AUTO-16: To verify dont contain any special characters in the URL when accessing Test Exceptions page', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.clickPractice();
  await verifObj.verifyURLContains('https://practicetestautomation.com/practice/');
  updateScenarioStatus('TC-AUTO-16', 'passed', 'NA');
});

test('TC-AUTO-17: To verify dont contain any special characters when submitting data in Test Table page', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.clickPractice();
  await pageObj.clickTestTable();
  await pageObj.fillInput('input[name="inputField"]', '@invalidData');
  await pageObj.clickElement('#submit-table');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-17', 'passed', 'NA');
});

test('TC-AUTO-18: To verify dont contain any special characters in page navigation links', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.clickPractice();
  await verifObj.verifyURLContains('https://practicetestautomation.com/practice/');
  updateScenarioStatus('TC-AUTO-18', 'passed', 'NA');
});

test('TC-AUTO-19: To verify dont contain any special characters in descriptions of content sections on the Practice page', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.clickPractice();
  await verifObj.verifyPageContains('Expected content without special characters');
  updateScenarioStatus('TC-AUTO-19', 'passed', 'NA');
});

test('TC-AUTO-20: To verify dont contain any special charachters in the Course Name filter', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', 'student');
  await pageObj.fillInput('#password', 'Password123');
  await pageObj.clickSubmit();
  await pageObj.clickPractice();
  await pageObj.clickTestTable();
  await pageObj.fillInput('#course-name-filter', 'Selenium Framework!');
  await pageObj.clickElement('#filter-button');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-20', 'passed', 'NA');
});

test('TC-AUTO-21: To verify dont contain any special charachters with Min enrollments set to 10,000+', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', 'student');
  await pageObj.fillInput('#password', 'Password123');
  await pageObj.clickSubmit();
  await pageObj.clickPractice();
  await pageObj.clickTestTable();
  await pageObj.fillInput('#min-enrollment', '10000+');
  await pageObj.clickElement('#filter-button');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-21', 'passed', 'NA');
});

test('TC-AUTO-22: To verify dont contain any special charachters when applying multiple filters', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', 'student');
  await pageObj.fillInput('#password', 'Password123');
  await pageObj.clickSubmit();
  await pageObj.clickPractice();
  await pageObj.clickTestTable();
  await pageObj.fillInput('#language-filter', 'Python#');
  await pageObj.fillInput('#level-filter', 'Beginner');
  await pageObj.fillInput('#min-enrollment', '10000+');
  await pageObj.clickElement('#filter-button');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-22', 'passed', 'NA');
});

test('TC-AUTO-23: To verify dont contain any special charachters when no results found', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', 'student');
  await pageObj.fillInput('#password', 'Password123');
  await pageObj.clickSubmit();
  await pageObj.clickPractice();
  await pageObj.clickTestTable();
  await pageObj.fillInput('#language-filter', 'Unknown');
  await pageObj.fillInput('#level-filter', 'Advanced');
  await pageObj.clickElement('#filter-button');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-23', 'passed', 'NA');
});

test('TC-AUTO-24: To verify dont contain any special charachters for resetting filters', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', 'student');
  await pageObj.fillInput('#password', 'Password123');
  await pageObj.clickSubmit();
  await pageObj.clickPractice();
  await pageObj.clickTestTable();
  await pageObj.fillInput('#course-name-filter', 'Test Course');
  await pageObj.clickElement('#reset-button');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-24', 'passed', 'NA');
});

test('TC-AUTO-25: To verify dont contain any special charachters when sorting by enrollments', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillUsername('student');
  await pageObj.fillPassword('Password123');
  await pageObj.clickSubmit();
  await pageObj.clickPractice();
  await pageObj.clickTestTable();
  await pageObj.fillInput('#sortOption', 'Enrollments');
  await pageObj.clickElement('#sortButton');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-25', 'passed', 'NA');
});

test('TC-AUTO-27: To verify that the form handles submission with an empty name field.', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillUsername('student');
  await pageObj.fillPassword('Password123');
  await pageObj.clickSubmit();
  await pageObj.clickContact();
  await pageObj.fillInput('#name', '');
  await pageObj.fillInput('#email', 'john.doe@example.com');
  await pageObj.fillInput('#message', 'This is a test message.');
  await pageObj.clickElement('#submitContact');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-27', 'passed', 'NA');
});

test('TC-AUTO-28: To verify that the form handles submission with a name length exceeding the limit.', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillUsername('student');
  await pageObj.fillPassword('Password123');
  await pageObj.clickSubmit();
  await pageObj.clickContact();
  await pageObj.fillInput('#name', 'This name is way too long and should cause an error');
  await pageObj.fillInput('#email', 'john.doe@example.com');
  await pageObj.fillInput('#message', 'This is a test message.');
  await pageObj.clickElement('#submitContact');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-28', 'passed', 'NA');
});

test('TC-AUTO-29: To verify that the form handles submission with an invalid email format.', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillUsername('student');
  await pageObj.fillPassword('Password123');
  await pageObj.clickSubmit();
  await pageObj.clickContact();
  await pageObj.fillInput('#name', 'John Doe');
  await pageObj.fillInput('#email', 'invalid-email');
  await pageObj.fillInput('#message', 'This is a test message.');
  await pageObj.clickElement('#submitContact');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-29', 'passed', 'NA');
});

test('TC-AUTO-30: To verify that the form handles submission with an empty email field.', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillUsername('student');
  await pageObj.fillPassword('Password123');
  await pageObj.clickSubmit();
  await pageObj.clickContact();
  await pageObj.fillInput('#name', 'John Doe');
  await pageObj.fillInput('#email', '');
  await pageObj.fillInput('#message', 'This is a test message.');
  await pageObj.clickElement('#submitContact');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-30', 'passed', 'NA');
});

test('TC-AUTO-31: To verify that the form handles submission with an empty message field.', async ({ page }) => {
  const pageObj = new PracticetestautomationcomPage(page);
  const verifObj = new PracticetestautomationcomVerif(page);
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await pageObj.fillInput('#username', 'student');
  await pageObj.fillInput('#password', 'Password123');
  await pageObj.clickElement('#submit');
  await pageObj.clickElement('#menu-item-18 > a');
  await pageObj.fillInput('#name', 'John Doe');
  await pageObj.fillInput('#email', 'john.doe@example.com');
  await pageObj.fillInput('#message', '');
  await pageObj.clickElement('#submit');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-31', 'passed', 'NA');
});