import { BasePage } from './BasePage.js';

export class practicetestautomationcompracticetestloginBatch1Page extends BasePage {
    constructor(page) {
        super(page);
        this.usernameField = page.locator('#username');
        this.passwordField = page.locator('#password');
        this.submitButton = page.locator('#submit');
        this.errorMessage = page.locator('#error');
    }

    async navigateToLoginPage(url) {
        await this.page.goto(url);
        await this.page.waitForLoadState('domcontentloaded');
        console.log(`Navigated to login page: ${url}`);
    }

    async fillLoginForm(username, password) {
        console.log(`Filling login form with username: \"${username}\" and password: \"${'*'.repeat(password.length)}\"`);
        await this.usernameField.fill(username);
        await this.passwordField.fill(password);
    }

    async submitLogin() {
        console.log('Clicking submit button.');
        await this.submitButton.click();
        await this.page.waitForLoadState('domcontentloaded'); // Wait for navigation or load state for robustness
    }

    async performLogin(username, password) {
        await this.fillLoginForm(username, password);
        await this.submitLogin();
        console.log('Login attempt completed.');
    }

    async verifySuccessfulLogin(expectedUrl, expectedSuccessContent, expectedLogoutButtonText) {
        console.log('Performing successful login verification.');
        const { practicetestautomationcompracticetestloginBatch1Verification } = require('../verification/practicetestautomation.com_practice_test_login_Batch_1_Verification.js');
        const verification = new practicetestautomationcompracticetestloginBatch1Verification(this.page);
        await verification.verifySuccessfulLogin(expectedUrl, expectedSuccessContent, expectedLogoutButtonText);
        console.log('Successful login verification completed.');
    }

    async verifyLoginError() {
        console.log('Performing login error verification.');
        const { practicetestautomationcompracticetestloginBatch1Verification } = require('../verification/practicetestautomation.com_practice_test_login_Batch_1_Verification.js');
        const verification = new practicetestautomationcompracticetestloginBatch1Verification(this.page);
        await verification.verifyLoginError();
        console.log('Login error verification completed.');
    }
}