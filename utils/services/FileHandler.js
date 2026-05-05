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
    this.queueDir = path.join(this.basePath, "test-results", "queue");

    [this.dataDir, this.snapshotsDir, this.domsDir, this.layoutsDir, this.scenariosDir, this.testsDir, this.pagesDir, this.verificationDir, this.reportsDir, this.obsDir, this.queueDir].forEach((dir) => {
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

  getLayoutImageBase64(safeName) {
    try {
      return fs.readFileSync(path.join(this.layoutsDir, `${safeName}.png`), "base64");
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
      const raw = fs.readFileSync(memoryPath, "utf8");
      // Try direct parse first
      try {
        return JSON.parse(raw);
      } catch (_) {
        // File is corrupt — attempt repair, then backup and reset
        console.warn(`-> [FileHandler] Corrupt scenarios file detected: ${memoryPath}. Attempting repair...`);
        try {
          const repaired = this.repairJsonArray(raw);
          const parsed = JSON.parse(repaired);
          // Write the repaired version back so future reads are clean
          fs.writeFileSync(memoryPath, JSON.stringify(parsed, null, 2));
          console.log(`-> [FileHandler] Repaired and restored ${parsed.length} scenarios.`);
          return parsed;
        } catch (repairErr) {
          // Unrecoverable — back up and start fresh
          const backupPath = memoryPath.replace('.json', `_backup_${Date.now()}.json`);
          fs.copyFileSync(memoryPath, backupPath);
          fs.writeFileSync(memoryPath, JSON.stringify([], null, 2));
          console.error(`-> [FileHandler] Could not repair file. Backed up to ${backupPath} and reset to [].`);
          return [];
        }
      }
    } catch (e) {
      return [];
    }
  }

  /**
   * Shared utility: scrub and repair a raw AI JSON string (array or object).
   * Handles: markdown fences, trailing commas, single quotes, unescaped control chars.
   */
  repairJsonArray(raw) {
    let s = (raw || "").trim();

    // 1. Strip markdown code fences (handle both ```json and ``` variants)
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    
    // If there are still embedded fences, extract content between them
    const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) s = fenceMatch[1].trim();

    // 2. Extract the outermost [ ... ] or { ... }
    const firstBracket = s.indexOf("[");
    const lastBracket  = s.lastIndexOf("]");
    const firstBrace   = s.indexOf("{");
    const lastBrace    = s.lastIndexOf("}");

    if (firstBracket !== -1 && lastBracket !== -1 && (firstBracket < firstBrace || firstBrace === -1)) {
      s = s.slice(firstBracket, lastBracket + 1);
    } else if (firstBrace !== -1 && lastBrace !== -1) {
      s = s.slice(firstBrace, lastBrace + 1);
    }

    // 3. Remove trailing commas before } or ] (handles newlines/spaces between comma and bracket)
    // Do this multiple times to catch nested cases
    for (let i = 0; i < 3; i++) {
      s = s.replace(/,(\s*[}\]])/g, "$1");
    }

    // 4. Remove any non-printable control characters except \n \r \t
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

    // 5. Handle common AI mistakes: JavaScript expressions in JSON
    // Replace ".repeat(N)" with actual repeated strings (up to 100 chars to avoid DoS)
    s = s.replace(/"([a-zA-Z0-9])+"\.repeat\((\d+)\)/g, (match, char, count) => {
      const n = Math.min(parseInt(count), 100);
      return `"${char.repeat(n)}"`;
    });

    return s;
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

  saveHybridPageFile(code) {
    const hybridDir = path.join(this.pagesDir, "Hybrid");
    if (!fs.existsSync(hybridDir)) fs.mkdirSync(hybridDir, { recursive: true });
    const filePath = path.join(hybridDir, "HybridPage.js");
    fs.writeFileSync(filePath, code);
    return filePath;
  }

  saveHybridVerificationFile(code) {
    const hybridDir = path.join(this.verificationDir, "Hybrid");
    if (!fs.existsSync(hybridDir)) fs.mkdirSync(hybridDir, { recursive: true });
    const filePath = path.join(hybridDir, "HybridVerif.js");
    fs.writeFileSync(filePath, code);
    return filePath;
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

  saveTestData(safeName, data) {
    const filePath = path.join(this.dataDir, `${safeName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`-> [Data] Saved captured user inputs to test-data/${safeName}.json`);
  }

  saveLocators(safeName, locators) {
    const filePath = path.join(this.dataDir, `${safeName}_locators.json`);
    fs.writeFileSync(filePath, JSON.stringify(locators, null, 2));
    console.log(`-> [Locators] Saved ${locators.length} locator(s) to test-data/${safeName}_locators.json`);
  }

  readLocators(safeName) {
    const filePath = path.join(this.dataDir, `${safeName}_locators.json`);
    if (!fs.existsSync(filePath)) return [];
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (e) {
      return [];
    }
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
