import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://gkeqa-hsbc.instantmseloans.in/enterprise/');
  await page.getByRole('textbox', { name: 'Email' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill('darshilho@opl.com');
  await page.locator('.mat-mdc-form-field-infix.ng-tns-c2306706986-1').click();
  await page.getByRole('textbox', { name: 'Password' }).fill('admin@123');
  await page.getByRole('button', { name: 'Log In' }).click();
  await page.getByText('I agree to the Terms and').click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByText('HSBC Super Admin').click();
});