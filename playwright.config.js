// @ts-check
import { defineConfig, devices } from '@playwright/test';


/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  
  /* Reporter Configuration */
  reporter: [
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['allure-playwright', { outputFolder: 'allure-results' }],
    ['list']
  ],
  
  /* Shared settings */
  use: {
    trace: 'retain-on-failure',
    screenshot: { mode: 'only-on-failure', fullPage: true },
    video: {
      mode: 'retain-on-failure',
      size: { width: 1920, height: 1080 }
    },
    viewport: { width: 1920, height: 1080 },
  },

  /* Configure projects */
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        screenshot: { mode: 'only-on-failure', fullPage: true },
        video: {
          mode: 'retain-on-failure',
          size: { width: 1920, height: 1080 }
        },
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
});

