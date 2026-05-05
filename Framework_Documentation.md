# Playwright Test Automation Framework Documentation

## 0. Installation Guide

### 0.1 Prerequisites
- **Visual Studio Code**: Latest version
- **Node.js**: Version 18 or higher
- **npm**: Comes with Node.js
- **Git**: For version control (optional)

### 0.2 Step-by-Step Installation from Visual Studio Code

**Step 1: Open Visual Studio Code**
- Launch Visual Studio Code
- Click `File` → `Open Folder`
- Navigate to `C:\Automation Projects\Framework` and select the folder

**Step 2: Open Integrated Terminal**
- Press `Ctrl + `` (backtick) or
- Click `Terminal` → `New Terminal` from menu

**Step 3: Install Dependencies**
```bash
npm install
```
This installs:
- @playwright/test (v1.57.0)
- allure-playwright (v3.0.0)
- mysql2 (v3.6.5)
- oracledb (v6.3.0)

**Step 4: Install Playwright Browsers**
```bash
npx playwright install
```

**Step 5: Verify Installation**
```bash
npx playwright --version
```

### 0.3 Updating Dependencies

**When package.json is updated, run:**
```bash
npm install
```

**Update specific package:**
```bash
npm update @playwright/test
npm update allure-playwright
```

**Update all packages:**
```bash
npm update
```

### 0.4 Quick Start
```bash
# Run all tests
npm run test

# Run specific module
npm run test tests/modulea
npm run test tests/moduleb

# Generate Allure report
npm run allure:report

# View Playwright HTML report
npm run playwright:report

# Record new tests
npm run codegen
```

## 1. Framework Structure Overview

```
Framework/
├── allure-results/                  # Allure test results
│   ├── *-result.json                # Test result files
│   ├── *-attachment.png             # Screenshots
│   ├── *-attachment.webm            # Videos
│   ├── *-attachment.zip             # Traces
│   ├── *-attachment.txt             # Logs
│   └── *-attachment.md              # Error contexts
├── config/                          # Configuration files
├── pages/                           # Page Object Model classes
│   ├── BasePage.js                  # Base class with common methods
│   └── LoginPage.js                 # Login page methods
├── playwright-report/               # Playwright HTML reports
│   └── index.html                   # Main report file
├── recorder/                        # Code generation utilities
│   ├── recordedscript/              # Generated test scripts
│   └── CodegenManager.js            # Codegen utility manager
├── reports/                         # Generated reports
│   ├── allure_report/               # Allure HTML reports
│   │   ├── data/                    # Report data
│   │   ├── widgets/                 # Report widgets
│   │   └── index.html               # Allure report page
│   └── html/                        # Playwright HTML reports
│       ├── data/                    # Report data
│       ├── trace/                   # Trace viewer
│       └── index.html               # Report page
├── test-data/                       # Test data management
│   ├── readConfig.js                # Configuration reader
│   └── testdata.json                # Test data
├── test-results/                    # Test execution results
│   ├── modulea-test--one-chromium/  # Module A results
│   │   ├── error-context.md         # Error details
│   │   ├── test-failed-1.png        # Failure screenshot
│   │   ├── trace.zip                # Execution trace
│   │   └── video.webm               # Test video
│   └── .last-run.json               # Last run metadata
├── tests/                           # Test specification files (MODULAR)
│   ├── modulea/                     # Module A tests
│   │   ├── test.spec.js             # @one and @two tests
│   │   └── test2.spec.js            # Additional tests
│   └── moduleb/                     # Module B tests
│       └── test.spec.js             # @one test
├── utils/                           # Utility functions
│   ├── DBConnection/                # Database connection utilities
│   │   ├── Java/                    # Java DB connection
│   │   └── JS/                      # JavaScript DB connection
│   ├── CommonMethods.js             # Common methods
│   └── DBQuery.js                   # Database query utilities
├── verification/                    # Verification modules
│   └── LoginPageVerification.js     # Dashboard verification
├── .gitignore                       # Git ignore rules
├── Framework_Documentation.md       # This documentation
├── package.json                     # Package configuration
├── package-lock.json                # Dependency lock file
└── playwright.config.js             # Playwright configuration
```

## 2. Key Features

### 2.1 Reporting
- **Dual Reporting**: Allure and Playwright HTML reports
- **Trace on Failure**: Automatic trace capture for failed tests
- **Screenshots**: Full-page screenshots on failure
- **Videos**: Video recording on failure (1920x1080)

### 2.2 Database Support
- **MySQL**: mysql2 package
- **Oracle**: oracledb package
- **Java Integration**: JDBC connections available

### 2.3 Test Organization
- **Modular Structure**: Tests organized by modules
- **Tag-based Execution**: @one, @two tags for selective execution
- **Parallel Execution**: Configurable workers

## 3. Command Execution Guide

### 3.1 Test Execution Commands

**Run All Tests:**
```bash
npm run test
```
Executes: `playwright test --project=chromium --headed --workers=1`

**Run Specific Module:**
```bash
npm run test tests/modulea
npm run test tests/moduleb
```

**Run Specific Test by Tag:**
```bash
npx playwright test --grep "@one"
npx playwright test --grep "@two"
```

**Module-Specific Tag:**
```bash
npx playwright test tests/modulea --grep "@one"
npx playwright test tests/moduleb --grep "@one"
```

**Headless Mode:**
```bash
npx playwright test tests/modulea
```

**Debug Mode:**
```bash
npx playwright test tests/modulea --debug
```

### 3.2 Report Commands

**Generate Allure Report:**
```bash
npm run allure:report
```
Generates and opens Allure report in browser

**View Playwright Report:**
```bash
npm run playwright:report
```
Opens Playwright HTML report

### 3.3 Recording Commands

**Record New Test:**
```bash
npm run codegen
```
Uses CodegenManager.js to record tests

**Manual Codegen:**
```bash
npx playwright codegen "https://url.com" --output recorder/recordedscript/new-test.js
```

## 4. Module Management

### 4.1 Current Modules

**Module A (tests/modulea/):**
- test.spec.js: @one (wrong password), @two (correct password)
- test2.spec.js: Additional tests
- Timeout: @one=30s, @two=60s

**Module B (tests/moduleb/):**
- test.spec.js: @one test
- Purpose: Secondary login validation

### 4.2 Adding New Module

```bash
# Create module directory
mkdir tests/modulec

# Create test file
echo. > tests/modulec/test.spec.js

# Run new module
npm run test tests/modulec
```

## 5. Configuration Details

### 5.1 Package.json Scripts

```json
"test": "playwright test --project=chromium --headed --workers=1"
"test:headed": "playwright test --project=chromium --headed --workers=1"
"codegen": "node recorder/CodegenManager.js"
"allure:report": "allure generate allure-results --clean -o reports\\allure_report && allure open reports\\allure_report"
"playwright:report": "playwright show-report reports/html"
```

### 5.2 Playwright Config Highlights

- **Test Directory**: ./tests
- **Parallel**: Fully parallel enabled
- **Workers**: 1 (sequential execution)
- **Reporters**: HTML, Allure, List
- **Trace**: Retain on failure
- **Screenshot**: Only on failure, full page
- **Video**: Retain on failure, 1920x1080
- **Viewport**: 1920x1080

## 6. Command Reference Quick Guide

```bash
# Installation
npm install
npx playwright install

# Run tests
npm run test                          # All tests
npm run test tests/modulea            # Module A
npm run test tests/moduleb            # Module B
npx playwright test --grep "@one"     # Tag-based

# Reports
npm run allure:report                 # Allure report
npm run playwright:report             # Playwright report

# Recording
npm run codegen                       # Record tests

# Update dependencies
npm install                           # After package.json changes
npm update                            # Update all packages
```

## 7. Best Practices

- Run `npm install` after pulling package.json changes
- Use module-based organization for scalability
- Tag tests appropriately (@one, @two, @smoke, @regression)
- Review reports after test execution
- Keep test data in testdata.json
- Use appropriate timeouts per test complexity

---

## 8. AI Hybrid Recorder v2.0 (The Zero-Touch Workflow)

The framework now features a fully autonomous AI-driven recording and execution pipeline.

### Core Enhancements:
- **Auto-Run Engine**: The framework automatically executes the generated Playwright integration script immediately after AI generation is complete.
- **60s Inactivity Guardian**: Monitors browser interactions. If idle for 60 seconds, the session auto-finalizes and triggers automation generation.
- **3-Tier POM Integration**: 
    - All Page Objects automatically extend `CommonMethods.js` for access to shared utility methods.
    - Specialized storage architecture in `pages/Hybrid/` and `verification/Hybrid/`.
- **Smart JSON Scrubber**: Advanced extraction logic that parses AI-generated code while filtering out conversational text or markdown.
- **Parallel Analysis**: AI Scenario Discovery runs in the background while the user is interacting with the browser, capturing 20+ edge cases per page.

---

**Framework Version:** 2.0.0 (AI Enhanced)  
**Playwright Version:** 1.57.0  
**Status:** Hybrid Auto-Trigger Active  

---
