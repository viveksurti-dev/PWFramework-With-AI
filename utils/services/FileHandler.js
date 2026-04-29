const fs = require("fs");
const path = require("path");
let xlsx;
try {
  xlsx = require("xlsx");
} catch (e) {
  xlsx = null;
}

class FileHandler {
  constructor(basePath) {
    // basePath should be the framework root
    this.basePath = basePath;
    
    this.dataDir = path.join(this.basePath, "test-data");
    this.snapshotsDir = path.join(this.basePath, "snapshots"); 
    this.domsDir = path.join(this.snapshotsDir, "DOMs");
    this.layoutsDir = path.join(this.snapshotsDir, "layouts");
    this.scenariosDir = path.join(this.basePath, "scenarios");
    this.testsDir = path.join(this.basePath, "tests");
    this.pagesDir = path.join(this.basePath, "pages");
    this.verificationDir = path.join(this.basePath, "verification");
    this.reportsDir = path.join(this.basePath, "reports");
    this.obsDir = path.join(this.basePath, "test-results", "observations");

    [this.dataDir, this.snapshotsDir, this.domsDir, this.layoutsDir, this.scenariosDir, this.testsDir, this.pagesDir, this.verificationDir, this.reportsDir, this.obsDir].forEach((dir) => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
  }

  saveLayout(safeName, cleanHtml, base64Image) {
    fs.writeFileSync(path.join(this.layoutsDir, `${safeName}.png`), base64Image, "base64");
    fs.writeFileSync(path.join(this.domsDir, `${safeName}.html`), cleanHtml || "No HTML generated");
    console.log(`-> [Extraction] Saved screenshot to snapshots/layouts/ & HTML DOM to snapshots/DOMs/`);
  }

  getLayoutHtml(safeName) {
    try {
      return fs.readFileSync(path.join(this.domsDir, `${safeName}.html`), "utf8");
    } catch (e) {
      return "";
    }
  }

  getMemoryPath(safeName) {
    return path.join(this.scenariosDir, `${safeName}_scenarios.json`);
  }

  readScenarios(memoryPath) {
    if (!fs.existsSync(memoryPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(memoryPath, "utf8"));
    } catch (e) {
      return [];
    }
  }

  saveScenarios(memoryPath, scenarios) {
    fs.writeFileSync(memoryPath, JSON.stringify(scenarios, null, 2));
  }

  saveTestBatch(safeName, batchIndex, code) {
    const testSubDir = path.join(this.testsDir, safeName);
    if (!fs.existsSync(testSubDir)) fs.mkdirSync(testSubDir, { recursive: true });
    const testFilePath = path.join(testSubDir, `Batch_${batchIndex}_${Date.now()}.spec.js`);
    fs.writeFileSync(testFilePath, code);
    return testFilePath;
  }

  savePageFile(safeName, batchIndex, className, code) {
    const pageFilePath = path.join(this.pagesDir, `${safeName}_Batch_${batchIndex}Page.js`);
    fs.writeFileSync(pageFilePath, code);
    return pageFilePath;
  }

  saveVerificationFile(safeName, batchIndex, className, code) {
    const verFilePath = path.join(this.verificationDir, `${safeName}_Batch_${batchIndex}_Verification.js`);
    fs.writeFileSync(verFilePath, code);
    return verFilePath;
  }

  saveCustomTest(testFileName, code) {
    const testFilePath = path.join(this.testsDir, testFileName);
    fs.writeFileSync(testFilePath, code);
    return testFilePath;
  }

  getMemoryFiles() {
    if (!fs.existsSync(this.scenariosDir)) return [];
    return fs.readdirSync(this.scenariosDir).filter(f => f.endsWith('.json'));
  }

  exportToExcel(scenarios, safeExcelName) {
    if (!xlsx) throw new Error("The 'xlsx' library is not installed.");
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(scenarios);
    xlsx.utils.book_append_sheet(wb, ws, "AI Scenarios");
    const excelPath = path.join(this.reportsDir, `${safeExcelName}.xlsx`);
    xlsx.writeFile(wb, excelPath);
    return excelPath;
  }

  readTestEnvironmentData() {
    const envData = {};
    if (fs.existsSync(this.dataDir)) {
      const files = fs.readdirSync(this.dataDir).filter(file => file.endsWith('.json'));
      for (const file of files) {
        try {
          const filePath = path.join(this.dataDir, file);
          const fileContent = fs.readFileSync(filePath, "utf8");
          const parsedData = JSON.parse(fileContent);
          const keyName = path.basename(file, '.json');
          envData[keyName] = parsedData;
        } catch (e) {
          console.error(`-> [Data Error] Failed to read or parse ${file}: ${e.message}`);
        }
      }
    }
    return envData;
  }
}

module.exports = new FileHandler(path.join(__dirname, "..", ".."));
