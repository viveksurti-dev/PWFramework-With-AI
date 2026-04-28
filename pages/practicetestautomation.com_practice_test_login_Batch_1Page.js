import { BasePage } from './BasePage.js';

class practicetestautomationcompracticetestloginBatch1Page extends BasePage {
    constructor(page) {
        super(page);
        this.usernameInput = this.page.locator('#username');
        this.passwordInput = this.page.locator('#password');
        this.submitButton = this.page.locator('#submit');
    }

    async fillUsername(username) {
        await this.usernameInput.fill(username);
        console.log(`Action: Filled username with '${username}'`);
    }

    async fillPassword(password) {
        await this.passwordInput.fill(password);
        console.log(`Action: Filled password with '${password}'`);
    }

    async clickSubmit() {
        await this.submitButton.click();
        console.log('Action: Clicked Submit button');
    }

    async login(username, password) {
        await this.fillUsername(username);
        await this.fillPassword(password);
        await this.clickSubmit();
        console.log(`Action: Attempted login with username '${username}' and password '${password}'`);
    }

    async verifyLoginSuccess(expectedUrl, expectedSuccessContent, expectedLogoutButtonText) {
        const { practicetestautomationcompracticetestloginBatch1Verification } = require('../verification/practicetestautomation.com_practice_test_login_Batch_1_Verification.js');
        const verification = new practicetestautomationcompracticetestloginBatch1Verification(this.page);
        await verification.verifySuccessfulLogin(expectedUrl, expectedSuccessContent, expectedLogoutButtonText);
    }

    async verifyLoginFailure() {
        const { practicetestautomationcompracticetestloginBatch1Verification } = require('../verification/practicetestautomation.com_practice_test_login_Batch_1_Verification.js');
        const verification = new practicetestautomationcompracticetestloginBatch1Verification(this.page);
        await verification.verifyErrorMessageVisible();
    }
}

export { practicetestautomationcompracticetestloginBatch1Page };