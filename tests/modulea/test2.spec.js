import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage.js';
const { ReadConfig } = require('../../test-data/readConfig.js');

test('@one', async ({ page }) => {
  test.setTimeout(180000); // 3 minutes timeout
  
  console.log('🚀 Starting Login Test Execution');
  
  const loginPage = new LoginPage(page);
  const email = ReadConfig.getUserName();
  const password = ReadConfig.getPassword();
  
  console.log(`📧 Using email: ${email}`);
  console.log('🔐 Password loaded from configuration');
  
  console.log('🌐 Initiating complete login flow...');
  await loginPage.completeLoginFlow(email, password);
  
  console.log('🔍 Starting dashboard verification...');
  await loginPage.verifyDashboard();
  
  console.log('✅ Login test completed successfully');
});

