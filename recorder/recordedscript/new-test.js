import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://gkeqa-hsbc.instantmseloans.in/enterprise/');
  await page.getByRole('textbox', { name: 'Email' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill('rutambh');
  await page.getByRole('button', { name: 'Log In' }).click();
});