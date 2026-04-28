import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://www.google.com/?zx=1767014834054&no_sw_cr=1');
  await page.getByRole('combobox', { name: 'Search' }).click();
  await page.getByText('titan lab grown diamonds').click();
});