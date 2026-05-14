import { CommonVerifications } from '../verification/CommonVerifications.js';
export class PracticetestautomationcomVerif extends CommonVerifications {
  constructor(page) { super(page); }
  async verifyCoursesPage() { await this.verifyURLContains('courses'); }
  async verifyTablePage() { await this.verifyURLContains('practice-test-table'); }
}