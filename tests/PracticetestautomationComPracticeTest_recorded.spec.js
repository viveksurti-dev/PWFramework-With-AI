import { test, expect } from '@playwright/test';
import { PracticetestautomationComPracticeTestPage } from '../pages/PracticetestautomationComPracticeTestPage.js';
import { readFileSync } from 'fs';

// Test data loaded from: E:\\PWFramework-With-AI-main\\test-data\\PracticetestautomationComPracticeTest_data.json
// Edit that file to change input values without touching this script.
const testData = JSON.parse(readFileSync('E:\\PWFramework-With-AI-main\\test-data\\PracticetestautomationComPracticeTest_data.json', 'utf8'));

test.describe('PracticetestautomationComPracticeTest — Recorded Journey', () => {

    test.beforeAll(() => {
        console.log('\n-> [Test Data] Loaded 0 field(s):');
        Object.entries(testData).forEach(([k, v]) => console.log(`   ${k}: ${v}`));
    });

    test('TC-REC-1: Full happy path recorded flow', async ({ page }) => {
        const pageObj = new PracticetestautomationComPracticeTestPage(page);

        await pageObj.practice_test_table(); // https://practicetestautomation.com/practice-test-table/
        await pageObj.courses(); // https://practicetestautomation.com/courses/
    });

});
