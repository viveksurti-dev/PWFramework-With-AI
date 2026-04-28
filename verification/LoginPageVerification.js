const { ReadConfig } = require('../test-data/readConfig.js');
const { expect } = require('@playwright/test');

class LoginPageVerification {
  constructor(page) {
    this.page = page;
    
    this.hsbcLogo = page.getByRole('img', { name: 'HSBC Bank Logo' });
    this.searchCompanyHeading = page.getByRole('heading', { name: 'Search Company' });
    this.existingPortfolioHeading = page.getByRole('heading', { name: 'Existing Portfolio' });
    this.profileDropdown = page.locator('#profileDropdown');
    this.wrongPasswordValidation = page.getByText('E-Mail ID or Password is invalid');
  }

  async verifyDashboardElements() {

  
    await expect.soft(this.hsbcLogo).toBeVisible();
    console.log('✅ HSBC Logo verified');
    
    await expect.soft(this.searchCompanyHeading).toBeVisible();
    console.log('✅ Search Company heading verified');
    
    await expect.soft(this.existingPortfolioHeading).toBeVisible();
    console.log('✅ Existing Portfolio heading verified');
    
    console.log('🎉 Dashboard verification completed successfully');
  }

  async verifyLoginValidaiton() {
    if (await this.wrongPasswordValidation.isVisible()) {
      console.log('Wrong username and Password.');
      throw new Error('Login failed');
    } else {
      console.log('✅ Logged in Successfully.');
    }
  }

}

module.exports = { LoginPageVerification };