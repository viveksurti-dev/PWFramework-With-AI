import { CommonMethods } from '../pages/CommonMethods.js';

export class PracticetestautomationcomPage extends CommonMethods {
  constructor(page) {
    super(page);
  }

  async navigateToLogin() {
    await this.navigateToUrl('https://practicetestautomation.com/practice-test-login/');
  }

  async fillUsername(username) {
    await this.fillInput('#username', username);
  }

  async fillPassword(password) {
    await this.fillInput('#password', password);
  }

  async clickSubmit() {
    await this.clickElement('#submit');
  }

  async clickPractice() {
    await this.clickElement('//nav/ul/li[2]/a');
  }

  async clickTestTable() {
    await this.clickElement('//div[3]/div[1]/p/a');
  }

  async clickContact() {
    await this.clickElement('//nav/ul/li[5]/a');
  }
}