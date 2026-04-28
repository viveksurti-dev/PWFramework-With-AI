import { ReadConfig } from "../test-data/readConfig.js";
import { BasePage } from "./BasePage.js";

export class LoginPage extends BasePage {
  constructor(page) {
    super(page);

    // DECLARATION OF XPATHS
    this.emailInput = page.getByRole("textbox", { name: "Email" });
    this.passwordInput = page.getByRole("textbox", { name: "Password" });
    this.loginButton = page.getByRole("button", { name: "Log In" });
    this.termsCheckbox = page.getByText("I agree to the Terms and");
    this.submitButton = page.getByRole("button", { name: "Submit" });
    this.adminText = page.getByText("HSBC Super Admin");
  }

  // TEST STARTS
  async navigateToLogin() {
    await this.page.goto(ReadConfig.getBaseUrl());
  }

  async login(email, password) {
    await this.emailInput.click();
    await this.emailInput.fill(email);
    await this.passwordInput.click();
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

    async verifyLoginValidaiton() {
    const { LoginPageVerification } = require('../verification/LoginPageVerification.js');
    const verification = new LoginPageVerification(this.page);
    await verification.verifyLoginValidaiton();
  }


  async acceptTerms() {
    await this.termsCheckbox.click();
    await this.submitButton.click();
  }

  async selectAdmin() {
    await this.adminText.click( { 
      waitUntil: 'networkidle', 
      timeout: 120000 //Default time is 30 Seconds
    });
  // Wait for automatic navigation to dashboard
  await this.page.waitForURL('**/dashboard/**', { timeout: 30000 });
  await this.page.waitForLoadState('networkidle');
  }

  async navigateToDashboard() {
    await this.page.goto(ReadConfig.getDashboardUrl());
  }


  async completeLoginFlow(email, password) {
    await this.navigateToLogin();
    await this.login(email, password);
    await this.verifyLoginValidaiton();
    await this.acceptTerms();
    await this.selectAdmin();
  }

  async verifyDashboard() {
    const { LoginPageVerification } = require('../verification/LoginPageVerification.js');
    const verification = new LoginPageVerification(this.page);
    await verification.verifyDashboardElements();
  }



}



