import { CommonVerifications } from '../verification/CommonVerifications.js';

export class PracticetestautomationcomVerif extends CommonVerifications {
  constructor(page) {
    super(page);
  }

  async verifyLoginSuccess() {
    await this.verifyURLContains('logged-in-successfully');
  }

  async verifyPracticePage() {
    await this.verifyURLContains('practice');
  }

  async verifyTestTablePage() {
    await this.verifyURLContains('practice-test-table');
  }

  async verifyContactPage() {
    await this.verifyURLContains('contact');
  }
}