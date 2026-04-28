import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage.js';
const { ReadConfig } = require('../../test-data/readConfig.js');
const { DBQuery } = require('../../utils/DBQuery.js');
const db = new DBQuery();

test.beforeAll(async () => {
  await db.connect('qa_oracle_jansuraksha'); //Declare the DB Environment you want to connect
});

test.afterAll(async () => {
  await db.close();
});

test('Verify User is able to Login', async ({ page }) => {
  // test.setTimeout(180000); // 3 minutes timeout
  
  console.log('🚀 Starting Login Test Execution');
  
  const loginPage = new LoginPage(page);
  const email = ReadConfig.getUserName();
  const password = ReadConfig.getWrongPassword();
  
  console.log(`📧 Using email: ${email}`);
  console.log('🔐 Password loaded from configuration');
  
  console.log('🌐 Initiating complete login flow...');
  await loginPage.completeLoginFlow(email, password);
  
  console.log('🔍 Starting dashboard verification...');
  await loginPage.verifyDashboard();
  
  console.log('✅ Login test completed successfully');
});

test('@DB Connection', async ({ page }) => {
  test.setTimeout(180000);
  
  console.log('🚀 Starting Login Test Execution');

      // Test MySQL Query
  const mysqlQuery = `SELECT jns_users."decvalue"(otp) as OTP FROM JNS_OTP.otp_logging_details WHERE jns_users."decvalue"(EMAIL) = 'rtbo@opl.com' ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`;
  const mysqlResult = await db.executeQueryByJS(mysqlQuery);
  const mysqlResult2 = await db.executeQueryByJava(mysqlQuery);
  console.log('MySQL Query Result by JS:', mysqlResult.rows[0] ? mysqlResult.rows[0][0] : 'No data');
  console.log('MySQL Query Result by JAVA:', mysqlResult2.rows[0] ? mysqlResult2.rows[0][0] : 'No data');
  console.log('MySQL Query Result by JS:',mysqlResult);
  
  // Test Oracle Query
  const idByJS = await db.getValueFromDBJS(mysqlQuery);
  const idByJava = await db.getValueFromDBJava(mysqlQuery);
  
  console.log('ID fetched by JS:', idByJS);
  console.log('ID fetched by Java:', idByJava);

});