const { readFileSync } = require("fs");
const { join } = require("path");

const filePath = join(__dirname, "testdata.json");

let TestData = {};

try {
  TestData = JSON.parse(readFileSync(filePath, "utf8"));
} catch (error) {
  throw new Error(`Failed to read testdata.json at ${filePath}`);
}

class ReadConfig {
  static getBaseUrl() {
    if (!TestData.login?.BASE_URL) {
      throw new Error("BASE_URL is missing in testdata.json");
    }
    return TestData.login.BASE_URL;
  }

  static getUserName() {
    return TestData.login.USER_NAME;
  }

  static getPassword() {
    return TestData.login.PASSWORD;
  }

    static getWrongPassword() {
    return TestData.login.WRONGPASSWORD;
  }

  static getExpectedUserName() {
  return TestData.verification.EXPECTED_USER_NAME;
  }

  static getDashboardUrl() {
  return TestData.verification.DASHBOARD_URL;
  }

  
}

module.exports = { ReadConfig };
