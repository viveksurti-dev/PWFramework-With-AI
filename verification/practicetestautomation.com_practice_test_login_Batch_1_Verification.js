const { expect } = require('@playwright/test');

class practicetestautomationcompracticetestloginBatch1Verification {
    constructor(page) {
        this.page = page;
        // Locators for successful login page (assuming this structure post-login)
        this.successHeader = page.locator('h1.post-title'); 
        this.logoutButton = page.locator('.wp-block-button__link', { hasText: 'Log out' });
        // Locator for error message on the login page
        this.errorMessage = page.locator('#error');
    }

    async verifySuccessfulLogin(expectedUrl, expectedSuccessContent, expectedLogoutButtonText) {
        await expect(this.page).toHaveURL(expectedUrl);
        await expect(this.successHeader).toBeVisible();
        await expect(this.successHeader).toHaveText(expectedSuccessContent);
        await expect(this.logoutButton).toBeVisible();
        await expect(this.logoutButton).toHaveText(expectedLogoutButtonText);
        console.log(`Verification: Successful login verified. URL: ${expectedUrl}, Content: '${expectedSuccessContent}', Logout button text: '${expectedLogoutButtonText}'`);
    }

    async verifyErrorMessageVisible() {
        await expect(this.errorMessage).toBeVisible();
        console.log('Verification: Error message element is visible, indicating login failure.');
    }
}

module.exports = { practicetestautomationcompracticetestloginBatch1Verification };