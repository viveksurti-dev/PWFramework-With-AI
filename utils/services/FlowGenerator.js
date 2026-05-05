const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const aiService = require("./AiEngine");
const fileService = require("./FileHandler");

class FlowGenerator {
    constructor() {
        this.flowRunning = false;
        this.currentGeneration = null;
    }

    normalizeFiles(filesData) {
        if (!filesData) return [];

        if (Array.isArray(filesData)) return filesData;

        // Handle object with fileName: content pairs
        if (typeof filesData === 'object') {
            return Object.entries(filesData).map(([fileName, content]) => ({
                fileName,
                content: typeof content === 'string' ? content : String(content)
            }));
        }

        return [];
    }

    getTestCodeContent(testCodeData) {
        if (!testCodeData) return null;

        if (typeof testCodeData === "string") return testCodeData;

        if (testCodeData.content) return testCodeData.content;

        const values = Object.values(testCodeData);
        return values.length ? String(values[0]) : null;
    }

    toPascalCase(str) {
        return str.replace(/(\w)(\w*)/g, (g0, g1, g2) => g1.toUpperCase() + g2.toLowerCase());
    }

    sanitizeFlowName(name) {
        let clean = name
            .replace(/[^a-zA-Z0-9]/g, "")
            .replace(/^\d+/, "");
        
        const truncated = clean.length > 25 ? clean.substring(0, 25) : clean;
        return this.toPascalCase(truncated);
    }

    ensureDir(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    ensureBaseFiles(flowName) {
        this.ensureDir(fileService.pagesDir);
        this.ensureDir(fileService.verificationDir);

        const pageClass = `${flowName}Page`;
        const verifClass = `${flowName}Verif`;

        const pagePath = path.join(
            fileService.pagesDir,
            `${pageClass}.js`
        );

        const verifPath = path.join(
            fileService.verificationDir,
            `${verifClass}.js`
        );

        if (!fs.existsSync(pagePath)) {
            fs.writeFileSync(
                pagePath,
`import { CommonMethods } from '../pages/CommonMethods.js';

export class ${pageClass} extends CommonMethods {
    constructor(page) {
        super(page);
    }
}`,
                "utf8"
            );

            console.log(`✓ Created ${pageClass}.js`);
        }

        if (!fs.existsSync(verifPath)) {
            fs.writeFileSync(
                verifPath,
`import { CommonVerifications } from '../verification/CommonVerifications.js';

export class ${verifClass} extends CommonVerifications {
    constructor(page) {
        super(page);
    }
}`,
                "utf8"
            );

            console.log(`✓ Created ${verifClass}.js`);
        }

        return { pageClass, verifClass };
    }

    repairImports(code, flowName, safeName) {
        if (!code) return "";

        const pageClass = `${flowName}Page`;
        const verifClass = `${flowName}Verif`;
        const memoryPath = fileService.getMemoryPath(safeName);

        // Remove all existing imports
        code = code.replace(/^import .*$/gm, "");
        code = code.replace(/^const .*require\(.*\);?$/gm, "");

        // Remove placeholders
        code = code.replace(/^\s*\.\.\.\s*$/gm, "");
        code = code.replace(/\/\/.*\.\.\..*$/gm, "");
        code = code.replace(/\/\*[\s\S]*?\.\.\.[\s\S]*?\*\//gm, "");

        // Fix wrong import paths from AI (./pageFiles/ or ./verificationFiles/)
        code = code.replace(/from\s+['"]\.\/pageFiles\//g, "from '../pages/");
        code = code.replace(/from\s+['"]\.\/verificationFiles\//g, "from '../verification/");

        const helperCode = `
import { test, expect } from '@playwright/test';
import { ${pageClass} } from '../pages/${pageClass}.js';
import { ${verifClass} } from '../verification/${verifClass}.js';
import { CommonMethods } from '../pages/CommonMethods.js';
import { CommonVerifications } from '../verification/CommonVerifications.js';
const fs = require('fs');
const path = require('path');

const scenariosFilePath = "${memoryPath.replace(/\\/g, "\\\\")}";

function updateScenarioStatus(scenarioId, status, remarks) {
    try {
        if (!fs.existsSync(scenariosFilePath)) {
            fs.writeFileSync(scenariosFilePath, JSON.stringify([], null, 2));
        }
        let scenarios = JSON.parse(fs.readFileSync(scenariosFilePath, "utf8"));
        let scenario = scenarios.find(s => s.scenarioId === scenarioId);
        if (scenario) {
            scenario.Status = status;
            scenario.executedDate = new Date().toISOString();
            if (remarks) scenario.remarks = remarks;
        } else {
            scenarios.push({
                scenarioId,
                scenario: scenarioId,
                Status: status,
                executedDate: new Date().toISOString(),
                remarks: remarks || "Success",
                createdBy: "AI Hybrid Flow",
                module: "Hybrid"
            });
        }
        fs.writeFileSync(scenariosFilePath, JSON.stringify(scenarios, null, 2));
    } catch(e) {}
}

test.afterEach(async ({ }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
        const scenarioIdMatch = testInfo.title.match(/^(TC-(?:AUTO|HYBRID)-\\d+)/);
        if (scenarioIdMatch) {
            updateScenarioStatus(scenarioIdMatch[1], 'Fail', testInfo.error ? testInfo.error.message : 'Failed');
        }
    }
});
`;

        code = helperCode + "\n" + code.trim();

        code = code.replace(
            new RegExp(`new\\s+${pageClass}\\s*\\(\\s*\\)`, "g"),
            `new ${pageClass}(page)`
        );

        return code;
    }

    validateGeneratedTest(code) {
        const issues = [];

        // Only flag require() if it's NOT inside a comment or string — raw require at statement level
        // We allow require() because repairImports injects fs/path requires
        // Just check for actual test blocks and placeholders
        if (/\n\s*\.\.\.\s*\n/.test(code))
            issues.push("Placeholder detected");

        if (!code.includes("test(") && !code.includes("test.describe("))
            issues.push("No test block");

        if (issues.length) {
            throw new Error(issues.join(", "));
        }
    }

    repairTruncatedJson(jsonStr) {
        if (!jsonStr) return "";
        let str = jsonStr.trim();
        
        // Count open/close braces and brackets
        let openBraces = (str.match(/{/g) || []).length;
        let closeBraces = (str.match(/}/g) || []).length;
        let openBrackets = (str.match(/\[/g) || []).length;
        let closeBrackets = (str.match(/\]/g) || []).length;
        
        // Add missing closing characters in reverse order
        // Usually it's string content, then brace, then brace
        
        // If it ends mid-string, close the string first
        const lastQuote = str.lastIndexOf('"');
        const lastBackslash = str.lastIndexOf('\\');
        if (lastQuote !== -1 && (lastBackslash === -1 || lastBackslash < lastQuote)) {
            // Check if there's an odd number of quotes in the last line or block
            const trailingContent = str.substring(str.lastIndexOf('\n') + 1);
            const quoteCount = (trailingContent.match(/"/g) || []).length;
            if (quoteCount % 2 !== 0) {
                str += '"';
            }
        }

        while (openBrackets > closeBrackets) {
            str += ']';
            closeBrackets++;
        }
        while (openBraces > closeBraces) {
            str += '}';
            closeBraces++;
        }
        
        return str;
    }

    parseAIResponse(responseText) {
        let cleanJson = responseText?.trim() || "";

        // Save original for debugging
        const originalResponse = cleanJson;

        // Use shared repair utility for consistent scrubbing
        cleanJson = fileService.repairJsonArray(cleanJson);

        console.log(`-> [Parse Debug] Response length: ${cleanJson.length} chars`);
        console.log(`-> [Parse Debug] First 200 chars: ${cleanJson.substring(0, 200)}`);

        // 1. Try Structured JSON Parsing FIRST (before raw code detection)
        try {
            const firstBrace = cleanJson.indexOf("{");
            const lastBrace = cleanJson.lastIndexOf("}");

            console.log(`-> [Parse Debug] First brace at: ${firstBrace}, Last brace at: ${lastBrace}`);

            if (firstBrace !== -1 && lastBrace !== -1) {
                let potentialJson = cleanJson.slice(firstBrace, lastBrace + 1);
                console.log(`-> [Parse Debug] Attempting to parse JSON of length: ${potentialJson.length}`);
                
                let parsed = null;
                try {
                    parsed = JSON.parse(potentialJson);
                } catch (err) {
                    console.warn(`-> [Parse Warning] Initial JSON parse failed. Attempting repair...`);
                    try {
                        const repaired = this.repairTruncatedJson(potentialJson);
                        parsed = JSON.parse(repaired);
                        console.log(`-> [Parse Debug] ✓ JSON repaired and parsed successfully.`);
                    } catch (repairErr) {
                        console.error(`-> [Parse Error] JSON repair failed: ${repairErr.message}`);
                    }
                }
                
                if (parsed) {
                    console.log(`-> [Parse Debug] JSON parsed successfully. Keys: ${Object.keys(parsed).join(', ')}`);
                    
                    // If it looks like our expected structure, use it
                    if (parsed.testCode || parsed.pageFiles || parsed.verificationFiles) {
                        return parsed;
                    }
                }
            }
        } catch (e) {
            console.warn(`-> [Parse Warning] Structured parsing logic failed: ${e.message}`);
        }

        // 2. Fallback: Regex-based extraction (if JSON.parse failed or returned wrong structure)
        // This handles cases where the AI returned a JSON-like string but we can still pull the code out
        console.warn(`-> [Parse Warning] Attempting Regex-based extraction as fallback...`);
        const result = { pageFiles: {}, verificationFiles: {}, testCode: {} };
        let foundSomething = false;

        // Extract testCode blocks
        const testCodeMatches = responseText.match(/"testCode"\s*:\s*\{([\s\S]*?)\}/);
        if (testCodeMatches) {
            const block = testCodeMatches[1];
            const fileMatches = block.matchAll(/"([^"]+)"\s*:\s*"([\s\S]*?)(?="|$)/g);
            for (const m of fileMatches) {
                result.testCode[m[1]] = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                foundSomething = true;
            }
        }

        // Extract pageFiles blocks
        const pageFilesMatches = responseText.match(/"pageFiles"\s*:\s*\{([\s\S]*?)\}/);
        if (pageFilesMatches) {
            const block = pageFilesMatches[1];
            const fileMatches = block.matchAll(/"([^"]+)"\s*:\s*"([\s\S]*?)(?="|$)/g);
            for (const m of fileMatches) {
                result.pageFiles[m[1]] = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                foundSomething = true;
            }
        }

        // Extract verificationFiles blocks
        const verifFilesMatches = responseText.match(/"verificationFiles"\s*:\s*\{([\s\S]*?)\}/);
        if (verifFilesMatches) {
            const block = verifFilesMatches[1];
            const fileMatches = block.matchAll(/"([^"]+)"\s*:\s*"([\s\S]*?)(?="|$)/g);
            for (const m of fileMatches) {
                result.verificationFiles[m[1]] = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                foundSomething = true;
            }
        }

        if (foundSomething) {
            console.log(`-> [Parse Debug] ✓ Successfully extracted ${Object.keys(result.testCode).length} tests via Regex.`);
            return result;
        }

        // 2. Fallback to Raw Code detection (only if JSON parsing failed)
        const isRawCode =
            cleanJson.includes("@playwright/test") ||
            cleanJson.includes("test(");

        console.log(`-> [Parse Debug] Fallback to raw code detection. isRawCode: ${isRawCode}`);

        if (isRawCode) {
            console.warn(`-> [Parse Warning] Treating entire response as raw code (Flow.spec.js)`);
            return {
                pageFiles: {},
                verificationFiles: {},
                testCode: {
                    "Flow.spec.js": cleanJson
                }
            };
        }

        throw new Error("Failed to parse AI response as either valid JSON or raw Playwright code.");
    }

    /**
     * Sanitize test title strings to remove apostrophes and possessives
     * that would break single-quoted JS strings.
     * Handles: test('...'), test("..."), test.describe('...'), test.describe("...")
     */
    sanitizeTestTitles(code) {
        if (!code) return code;

        const fixTitle = (title) => title
            // Common contractions → expanded forms
            .replace(/can't/gi,      'cannot')
            .replace(/doesn't/gi,    'does not')
            .replace(/don't/gi,      'do not')
            .replace(/didn't/gi,     'did not')
            .replace(/won't/gi,      'will not')
            .replace(/isn't/gi,      'is not')
            .replace(/aren't/gi,     'are not')
            .replace(/wasn't/gi,     'was not')
            .replace(/weren't/gi,    'were not')
            .replace(/haven't/gi,    'have not')
            .replace(/hasn't/gi,     'has not')
            .replace(/hadn't/gi,     'had not')
            .replace(/shouldn't/gi,  'should not')
            .replace(/wouldn't/gi,   'would not')
            .replace(/couldn't/gi,   'could not')
            .replace(/it's/gi,       'it is')
            .replace(/that's/gi,     'that is')
            .replace(/there's/gi,    'there is')
            .replace(/they're/gi,    'they are')
            .replace(/we're/gi,      'we are')
            .replace(/you're/gi,     'you are')
            // Possessives: user's → user, system's → system
            .replace(/(\w+)'s\b/g,   '$1')
            // Any remaining apostrophe
            .replace(/'/g,           '');

        // Match test( or test.describe( with either single or double quoted title
        // Regex: (test(?:\.describe)?)\s*\(\s*(['"])(.*?)\2
        return code.replace(
            /(test(?:\.describe)?)\s*\(\s*(['"])([\s\S]*?)\2/g,
            (match, fn, quote, title) => {
                const fixed = fixTitle(title);
                // Always normalise to single quotes for consistency
                return `${fn}('${fixed}'`;
            }
        );
    


        const pageClass = `${flowName}Page`;

        return `
test('Generated flow', async ({ page }) => {
    const flowPage = new ${pageClass}(page);

    await page.goto('${startUrl}');
});
`;
    }

    async generateHybridFlow(
        safeName,
        passedStartUrl,
        passedFlowContext
    ) {
        if (this.flowRunning) {
            console.log("-> [Flow Gen] Already running, waiting for current task...");
            return this.currentGeneration;
        }

        // 0. Wait for Queue Processor to finish all background work
        const queueProcessor = require("./QueueProcessor");
        await queueProcessor.waitForCompletion();

        this.flowRunning = true;
        this.currentGeneration = this._internalGenerate(safeName, passedStartUrl, passedFlowContext);
        
        try {
            return await this.currentGeneration;
        } finally {
            this.flowRunning = false;
            this.currentGeneration = null;
        }
    }

    async waitForCompletion() {
        if (this.currentGeneration) {
            console.log("-> [Flow Gen] Waiting for ongoing generation to complete...");
            await this.currentGeneration;
        }
    }

    async _internalGenerate(
        safeName,
        passedStartUrl,
        passedFlowContext
    ) {
        try {
            const flowName = this.sanitizeFlowName(safeName);
            let flowContext = passedFlowContext;
            let startUrl = passedStartUrl;

            // 1. Auto-Load Journey if not provided
            if (!flowContext || (Array.isArray(flowContext) && flowContext.length === 0) || (typeof flowContext === 'object' && Object.keys(flowContext).length === 0)) {
                const queuePath = path.join(fileService.queueDir, "queue_status.json");
                if (fs.existsSync(queuePath)) {
                    try {
                        const session = JSON.parse(fs.readFileSync(queuePath, "utf8"));
                        flowContext = session.journey || [];
                        console.log(`-> [Flow Gen] Loaded ${flowContext.length} journey steps from queue.`);
                    } catch (e) {
                        console.error("-> [Flow Gen] Failed to load journey from queue:", e.message);
                    }
                }
            }

            // 2. Auto-Determine Start URL
            if (!startUrl && Array.isArray(flowContext) && flowContext.length > 0) {
                startUrl = flowContext[0].url;
            }

            // 3. Load Captured User Inputs
            const capturedDataPath = path.join(fileService.dataDir, `${safeName}.json`);
            let capturedData = {};
            if (fs.existsSync(capturedDataPath)) {
                try {
                    capturedData = JSON.parse(fs.readFileSync(capturedDataPath, "utf8"));
                    console.log("-> [Flow Gen] Loaded captured user inputs.");
                } catch (e) {}
            }

            // 3b. Load Captured Locators for the happy path journey
            const capturedLocators = fileService.readLocators(safeName);
            const sanitizedLocators = capturedLocators.map(loc => {
                const s = { ...loc };
                if (s.locators && s.locators.xpath) {
                    // Ensure XPath starts with //
                    if (!s.locators.xpath.startsWith('//') && !s.locators.xpath.startsWith('(')) {
                        s.locators.xpath = '//' + s.locators.xpath.replace(/^\/+/, '');
                    }
                }
                return s;
            });

            if (sanitizedLocators.length > 0) {
                console.log(`-> [Flow Gen] Loaded ${sanitizedLocators.length} recorded locator(s) for selector accuracy.`);
            }

            // 4. Load Existing Scenarios for ID Mapping
            const scenariosPath = fileService.getMemoryPath(safeName);
            let existingScenarios = [];
            if (fs.existsSync(scenariosPath)) {
                try {
                    existingScenarios = JSON.parse(fs.readFileSync(scenariosPath, "utf8"));
                    console.log(`-> [Flow Gen] Loaded ${existingScenarios.length} existing scenarios for ID mapping.`);
                } catch (e) {}
            }

            const { pageClass, verifClass } =
                this.ensureBaseFiles(flowName);

            // 5. Load DOM Context for each step to ensure selector accuracy
            let domContext = "";
            if (Array.isArray(flowContext)) {
                for (const step of flowContext) {
                    if (step.stepName) {
                        const html = fileService.getLayoutHtml(step.stepName);
                        if (html) {
                            // Take a significant chunk of HTML for context
                            domContext += `\n--- DOM Structure for: ${step.url} ---\n${html.substring(0, 8000)}\n`;
                        }
                    }
                }
            }

            // 5b. Read CommonMethods to get available inherited methods
            const commonMethodsPath = path.join(fileService.pagesDir, 'CommonMethods.js');
            let commonMethodsList = [];
            if (fs.existsSync(commonMethodsPath)) {
                const commonMethodsContent = fs.readFileSync(commonMethodsPath, 'utf8');
                const methodMatches = commonMethodsContent.matchAll(/async\s+(\w+)\s*\(/g);
                commonMethodsList = Array.from(methodMatches).map(m => m[1]);
                console.log(`-> [Flow Gen] CommonMethods available: ${commonMethodsList.join(', ')}`);
            }

            // 5c. Read CommonVerifications to get available inherited methods
            const commonVerifPath = path.join(fileService.verificationDir, 'CommonVerifications.js');
            let commonVerifMethodsList = [];
            if (fs.existsSync(commonVerifPath)) {
                const commonVerifContent = fs.readFileSync(commonVerifPath, 'utf8');
                const methodMatches = commonVerifContent.matchAll(/async\s+(\w+)\s*\(/g);
                commonVerifMethodsList = Array.from(methodMatches).map(m => m[1]);
                console.log(`-> [Flow Gen] CommonVerifications available: ${commonVerifMethodsList.join(', ')}`);
            }

            const commonMethodsContext = commonMethodsList.length > 0
                ? `\n\nCOMMON METHODS AVAILABLE (Inherited by ALL page classes):\n${commonMethodsList.map(m => `- ${m}()`).join('\n')}\nYou MUST use these methods instead of raw page.locator() calls.`
                : "";

            const commonVerifContext = commonVerifMethodsList.length > 0
                ? `\n\nCOMMON VERIFICATION METHODS AVAILABLE (Inherited by ALL verification classes):\n${commonVerifMethodsList.map(m => `- ${m}()`).join('\n')}\nYou MUST use these methods for all assertions.`
                : "";

            const prompt = `
Generate STRICT VALID JSON ONLY.

Flow Name: ${flowName}
Start URL: ${startUrl}

Recorded Journey Sequence (Follow this EXACTLY):
${JSON.stringify(flowContext, null, 2)}

**CRITICAL - JOURNEY URL ACCURACY**:
The "Recorded Journey Sequence" above contains the EXACT URLs the user visited.
- DO NOT invent or guess URLs
- DO NOT change URL paths (e.g., if journey shows "practice-test-table", do NOT use "practice-test-exceptions")
- EVERY URL in your generated code MUST match a URL from the journey above
- EVERY verification method MUST use URL fragments that appear in the journey above
- If the journey shows 4 URLs, your HappyPath test should navigate through those EXACT 4 URLs
- Example: If journey shows "practice-test-table", your verification MUST check for "practice-test-table", NOT "practice-test-exceptions"

Captured User Inputs (Use these values in the test):
${JSON.stringify(capturedData, null, 2)}

RECORDED LOCATORS — EXACT SELECTORS FROM THE LIVE PAGE (HIGHEST PRIORITY):
These were captured directly from the browser during the user's recording session.
You MUST prioritize selectors in this order:
1. ID (e.g., #username)
2. XPath (MUST start with //, e.g., //div[@id='login'])
3. innerText / unique text (e.g., page.getByText('Submit'))
4. Name attribute (e.g., [name='q'])
5. CSS Selectors (ONLY as a last resort if nothing else is available)

${sanitizedLocators.length > 0 ? JSON.stringify(sanitizedLocators, null, 2) : "No locators recorded — use DOM context below to find selectors."}

Reference HTML DOM Context for Steps (Use these to find EXACT selectors/IDs):
${domContext}${commonMethodsContext}${commonVerifContext}

Existing Scenarios List (CRITICAL: Map your tests to these IDs):
${JSON.stringify(existingScenarios, null, 2)}

Rules:
1. No markdown
2. No code fences
3. No comments
4. No placeholders (...)
5. Must return executable Playwright code
6. ES6 modules only: use import statements, NEVER require(), module.exports, or CommonJS
7. Use expect from '@playwright/test' for assertions
8. STRING SAFETY (CRITICAL):
   - NEVER use apostrophes (') in test titles - use "does not" instead of "doesn't"
   - NEVER use single quotes inside single-quoted strings
   - NEVER use possessive forms with apostrophes (use "system" not "system's", "user" not "user's")
   - Always escape special characters in strings
   - Example: test('TC-AUTO-1: To verify user cannot login', ...) ✓
   - Example: test('TC-AUTO-1: To verify user can't login', ...) ✗ WRONG
   - Example: test('TC-AUTO-1: To verify the system response', ...) ✓
   - Example: test('TC-AUTO-1: To verify the system's response', ...) ✗ WRONG
- No markdown
- No code fences
- No comments
- No placeholders (...)
- Must return executable Playwright code
- ES6 modules only: use import statements, NEVER require(), module.exports, or CommonJS
- Use expect from '@playwright/test' for assertions
- Ensure all steps in the journey are covered in the test.
- Use the Captured User Inputs for any form fields or actions described in the journey.
- JOURNEY COMPLETENESS (CRITICAL): The HappyPath test MUST include EVERY step from the "Recorded Journey Sequence". 
  * Count the steps in the journey and ensure your test has a corresponding action for each one.
  * If the journey has 10 clicks, your test should have 10 corresponding method calls.
  * Use the RECORDED LOCATORS to identify what action was performed at each step (click vs input).
  * Do NOT skip or combine steps - each recorded interaction should map to a method call in the test.
  * HAPPY PATH MUST WORK - it follows the exact user recording, so all selectors exist
  * For HappyPath: Use ONLY the selectors from RECORDED LOCATORS - these are guaranteed to exist
  * For HappyPath: Follow the journey sequence EXACTLY - same order, same actions
  * For HappyPath: Do NOT add extra verification steps that weren't in the journey
  * For HappyPath: After each action, verify ONLY the URL change (if URL changed in journey)
- BASE CLASS INHERITANCE (MANDATORY):
  * Every class in "pageFiles" MUST extend CommonMethods: \`export class ${pageClass} extends CommonMethods\`
    Import it as: \`import { CommonMethods } from '../pages/CommonMethods.js';\`
    Constructor MUST call \`super(page);\` before anything else.
    Use inherited helpers from COMMON METHODS AVAILABLE list above - NEVER use raw page.locator() calls.
  * Every class in "verificationFiles" MUST extend CommonVerifications: \`export class ${verifClass} extends CommonVerifications\`
    Import it as: \`import { CommonVerifications } from '../verification/CommonVerifications.js';\`
    Constructor MUST call \`super(page);\` before anything else.
    Use inherited helpers from COMMON VERIFICATION METHODS AVAILABLE list above - NEVER use raw expect() calls.
  * CRITICAL: ANALYZE the COMMON METHODS AVAILABLE and COMMON VERIFICATION METHODS AVAILABLE lists above BEFORE writing any code.
  * ONLY use methods that are listed in those sections.
  * DO NOT create methods that duplicate base class functionality.
  * DO NOT override base class methods with the same name.
  * NEVER create a method like \`async verifyErrorVisible() { await this.verifyErrorVisible(); }\` - this causes infinite recursion!
- Use NAMED EXPORTS only (e.g., export class ${pageClass} { ... }). NEVER use "export default".
- CRITICAL: Use the provided HTML DOM context to find the most stable selectors (IDs, names, or clear CSS). Avoid generic guesses like 'button[type="submit"]' if an ID like '#submit' is visible.
- RELIABILITY: Always use await page.waitForURL(url) before asserting elements on a new page. Use the EXACT URL from the "Recorded Journey Sequence" for the next step.
- METHOD DEFINITION (STRICT): 
  * You MUST define every method you call in the "testCode" inside the "pageFiles" or "verificationFiles".
  * If your test calls \`await pageObj.navigateToLogin()\`, you MUST have \`async navigateToLogin() { ... }\` defined in the class.
  * NEVER assume a method exists if you haven't written it in the output.
  * NEVER return an empty class (just a constructor) if the test relies on methods from that class.
- NO DUPLICATION: If a method like \`login\` is already used in HappyPath, use the SAME method in NegativeScenarios. Do not create \`loginUser\` and \`performLogin\`.
- ASSERTIONS: Use URL-based assertions (e.g., expect(page).toHaveURL(/.*logged-in-successfully/)) as the primary check. Do not guess page titles (like "Dashboard") unless you see them in the DOM context.
- CONSISTENCY (STRICT): Every interaction and assertion (besides simple URL checks) MUST be encapsulated in methods within "pageFiles" or "verificationFiles". NEVER use raw page.locator() or direct element assertions (expect(page.locator(...))) in the "testCode".
- NO HALLUCINATION: Do not invent URLs with "#" or guessing titles. Stick to the provided Journey Sequence and DOM.
- SELECTORS: When finding selectors in the DOM, prefer IDs (#username, #submit) over generic tags or guessing.
- SELECTOR PRIORITY & FORMATTING (MANDATORY): 
  * 1st Priority: ID (#id)
  * 2nd Priority: XPath - ALWAYS ensure it starts with '//' (e.g., //button[@type='submit'])
  * 3rd Priority: Unique Text (e.g., getByText('Login'))
  * AVOID: Never use generic CSS paths like 'div > p > a' or 'nth-of-type' if an ID or XPath is available.
  * If a recorded locator has an ID, use it. If not, use the XPath (starting with //).
- BEYOND HAPPY PATH: You MUST generate two separate test files in the "testCode" object:
    a) "HappyPath.spec.js": A clean execution of the EXACT recorded journey sequence using the captured user inputs.
       - Use ONLY recorded locators and journey steps
       - Do NOT add extra verifications beyond URL checks
       - Do NOT invent selectors or elements
       - This test MUST pass because it replays the exact user recording
    b) "NegativeScenarios.spec.js": At least 2-3 negative test cases derived from the journey. For example, if the journey involves a login, add a test for "Login with invalid password". If it involves a form, add a test for "Submit with missing required fields". Use elements found in the DOM context to identify what could go wrong.
       - These tests should EXPECT FAILURE (errors, validation messages)
       - Use verifyErrorVisible() to check for error messages
       - Do NOT create positive/success scenarios in this file
       - Filter out scenarios with words: "successful", "successfully", "success", "logs in"
- ERROR VALIDATION (NEGATIVE FLOWS): In "NegativeScenarios.spec.js", when verifying failure:
    - The test should stay on the same page or redirect to an error page.
    - Call verif methods with NO arguments: await verifPage.verifyLoginError() — NEVER pass a locator, page reference, or getByText() result as an argument to any verif method.
    - Verification methods handle their own locators internally using the #error ID.
    - ALWAYS use await before every verif method call.
    - Use verifyLoginError() / verifyErrorVisible() / verifyErrorMessage() for all error checks — never call expect() directly in testCode.
19. SCENARIO TRACKING & ID MAPPING: 
    - Every test block MUST start its title with a matching ID from the "Existing Scenarios List" (e.g., test('TC-AUTO-1: description', ...)).
    - At the VERY END of each test successful path, you MUST call 'updateScenarioStatus(id, status, remarks)' using that SAME ID.
    - If a test you generate (like a specific negative case) has no close match in the "Existing Scenarios List", only then create a new ID like 'TC-HYBRID-XXX'.
    - DO NOT create new 'TC-HYBRID' IDs if a relevant 'TC-AUTO' scenario already exists.
20. CLEAN PAGE OBJECTS (CRITICAL): Interaction methods in 'pageFiles' (e.g., login, submitForm, navigateTo) MUST NOT contain 'await page.waitForURL(...)' or 'expect(...)'. They should strictly perform actions (fill, click, etc.). All waiting for navigation and success/failure assertions MUST be handled by dedicated methods in the 'verificationFiles'. This ensures that interaction methods can be reused in both positive and negative test scenarios.
21. VERIFICATION METHODS (MANDATORY - CRITICAL - NO HALLUCINATION):
    The verificationFiles MUST contain actual verification methods based on the RECORDED JOURNEY and DOM CONTEXT.
    
    **STEP 1 - ANALYZE THE JOURNEY**:
    - Read the "Recorded Journey Sequence" to see what pages the user visited
    - Read the "Reference HTML DOM Context" to find ACTUAL selectors on those pages
    - Read the "RECORDED LOCATORS" to see what elements were interacted with
    
    **STEP 2 - CREATE VERIFICATION METHODS FOR EACH PAGE**:
    - For each URL in the journey, create ONE verify method
    - Use verifyURLContains() with a unique part of the URL (NOT full regex pattern)
    - Example: verifyURLContains('logged-in-successfully') instead of verifyURLPattern(/.*logged-in-successfully/)
    - DO NOT add element checks unless you can see the EXACT text or ID in the DOM context
    
    **STEP 3 - USE ONLY REAL SELECTORS FROM DOM**:
    - Search the DOM context for unique text content (h1, h2, p tags with specific text)
    - Search for IDs (id="logout", id="error")
    - NEVER invent selectors like '.success-message', '.post-title', 'selector-for-some-element'
    - If you cannot find a selector in the DOM context, use ONLY URL verification
    
    **STEP 4 - VERIFY ONLY AFTER NAVIGATION**:
    - Only call verification methods AFTER an action that changes the page
    - If a method just clicks a button but doesn't navigate, DON'T verify URL
    - Wait for the page to actually load before verifying
    
    **EXAMPLE - CORRECT (URL contains)**:
    
    async verifyLoginSuccess() {
      await this.verifyURLContains('logged-in-successfully');
    }
    
    async verifyPracticePage() {
      await this.verifyURLContains('practice');
    }
    
    **EXAMPLE - WRONG (too strict pattern)**:
    
    async verifyTestTablePage() {
      await this.verifyURLPattern(/.*practice-test-table/); // WRONG - too strict
    }
    
    **EXAMPLE - WRONG (invented selector)**:
    
    async verifySuccessMessage() {
      await this.verifyElementVisible('.success-message'); // WRONG - not in DOM
    }
    
    async verifyElement() {
      await this.verifyElementVisible('selector-for-some-expected-element'); // WRONG - hallucination
    }
    
    **REQUIREMENTS**:
    - DO NOT leave verification files empty with only constructor
    - Every verification method called in testCode MUST exist in the verification file
    - Use ONLY these inherited methods: verifyURL(), verifyURLContains(), verifyErrorVisible(), verifyPageContains()
    - PREFER verifyURLContains(text) over verifyURLPattern(regex) - it's more flexible
    - NEVER use verifyElementVisible() unless you have the EXACT selector from DOM context
    - Create 3-5 verification methods based on the journey
    - When in doubt, use ONLY verifyURLContains() - it is always safe
    - NEVER invent CSS selectors, class names, or IDs that are not in the DOM context

Format:
{
  "pageFiles": {
     "${pageClass}.js": "..."
  },
  "verificationFiles": {
     "${verifClass}.js": "..."
  },
  "testCode": {
     "HappyPath.spec.js": "...",
     "NegativeScenarios.spec.js": "..."
  }
}
`;

            console.log("-> Calling AI...");

            const responseText =
                await aiService.callAIWithFallback(prompt);

            fs.writeFileSync(
                "debug_ai_response.txt",
                responseText,
                "utf8"
            );

            const aiResult =
                this.parseAIResponse(responseText);

            console.log("-> AI parsed successfully.");

            const allFiles = [
                ...this.normalizeFiles(aiResult.pageFiles),
                ...this.normalizeFiles(aiResult.verificationFiles)
            ];

            for (const f of allFiles) {
                // Route to correct directory based on filename suffix
                const isVerification = f.fileName.toLowerCase().includes("verif");
                const targetDir = isVerification ? fileService.verificationDir : fileService.pagesDir;

                // ── Content/filename mismatch guard ──────────────────────────
                // Detect when AI writes the wrong class into the wrong file
                // e.g. a Verif class saved into a Page file, or vice-versa
                const contentHasVerifClass = /class\s+\w+Verif\b/.test(f.content);
                const contentHasPageClass  = /class\s+\w+Page\b/.test(f.content);

                if (!isVerification && contentHasVerifClass && !contentHasPageClass) {
                    console.error(`❌ MISMATCH: ${f.fileName} is a Page file but contains a Verif class. Skipping to prevent overwriting the real page object.`);
                    continue;
                }
                if (isVerification && contentHasPageClass && !contentHasVerifClass) {
                    console.error(`❌ MISMATCH: ${f.fileName} is a Verif file but contains a Page class. Skipping to prevent overwriting the real verif object.`);
                    continue;
                }

                // Validate page files are not empty (must have methods beyond constructor)
                if (!isVerification) {
                    const methodsCount = (f.content.match(/async\s+\w+\s*\(/g) || []).length;
                    if (methodsCount === 0) {
                        console.error(`❌ ERROR: ${f.fileName} has NO interaction methods!`);
                        console.error(`❌ AI failed to generate methods for this page. Skipping this file to preserve existing code.`);
                        continue; 
                    }
                }

                // Validate verification files are not empty
                if (isVerification) {
                    const hasOnlyConstructor = f.content.includes('constructor') && 
                                              !f.content.match(/async\s+verify[A-Z]/);
                    if (hasOnlyConstructor) {
                        console.error(`❌ ERROR: ${f.fileName} has no verification methods!`);
                        console.error(`❌ AI failed to generate verification methods. Skipping this file.`);
                        continue; 
                    }
                }
                
                fs.writeFileSync(
                    path.join(targetDir, f.fileName),
                    f.content,
                    "utf8"
                );

                console.log(`✓ ${isVerification ? "Verification" : "Page"}: ${f.fileName}`);
            }

            const testFiles = this.normalizeFiles(aiResult.testCode);
            
            console.log(`-> [Debug] Normalized ${testFiles.length} test file(s): ${testFiles.map(f => f.fileName).join(', ')}`);
            
            // Debug: Check if any test file content contains JSON structure
            for (const tf of testFiles) {
                if (tf.content && (tf.content.includes('"pageFiles"') || tf.content.includes('"verificationFiles"'))) {
                    console.error(`❌ ERROR: Test file '${tf.fileName}' contains JSON structure instead of code!`);
                    console.error(`❌ This means the AI response was not parsed correctly.`);
                    console.error(`❌ First 500 chars of content: ${tf.content.substring(0, 500)}`);
                    
                    // Try to extract just the test code if it's embedded
                    const testCodeMatch = tf.content.match(/(import.*?test\(.*?\n\}\);)/s);
                    if (testCodeMatch) {
                        console.log(`-> [Debug] Attempting to extract test code from JSON structure...`);
                        tf.content = testCodeMatch[1];
                    } else {
                        console.error(`❌ Could not extract test code. Skipping this file.`);
                        continue;
                    }
                }
            }
            
            // Validate that verification methods match journey URLs
            if (Array.isArray(flowContext) && flowContext.length > 0) {
                const journeyUrls = flowContext.map(step => step.url).filter(Boolean);
                console.log(`-> [Validation] Journey URLs: ${journeyUrls.join(', ')}`);
                
                // Check verification file for URL mismatches
                const verifFiles = this.normalizeFiles(aiResult.verificationFiles);
                for (const vf of verifFiles) {
                    // Extract URL fragments from verifyURLContains() calls
                    const urlChecks = vf.content.match(/verifyURLContains\(['"]([^'"]+)['"]\)/g);
                    if (urlChecks) {
                        for (const check of urlChecks) {
                            const urlFragment = check.match(/verifyURLContains\(['"]([^'"]+)['"]\)/)[1];
                            // Check if this fragment appears in any journey URL
                            const matchesJourney = journeyUrls.some(url => url.includes(urlFragment));
                            if (!matchesJourney) {
                                console.warn(`⚠️  WARNING: Verification checks for '${urlFragment}' but this doesn't appear in the recorded journey!`);
                                console.warn(`⚠️  Journey URLs: ${journeyUrls.join(', ')}`);
                                console.warn(`⚠️  This test will likely fail. The AI may have hallucinated a URL.`);
                            }
                        }
                    }
                }
            }
            
            if (testFiles.length === 0) {
                console.warn("-> [Warning] No test files generated by AI. Creating fallback.");
                const fallback = this.getFallbackTest(flowName, startUrl);
                testFiles.push({ fileName: "Flow.spec.js", content: fallback });
            }

            let lastSavedPath = null;
            const shortSafeName = safeName.length > 20 ? safeName.substring(0, 20) : safeName;
            const timestamp = Date.now();

            for (const tFile of testFiles) {
                let testContent = tFile.content;
                
                // Sanitize apostrophes / possessives in all test titles
                testContent = this.sanitizeTestTitles(testContent);
                
                try {
                    this.validateGeneratedTest(testContent);
                } catch (err) {
                    console.warn(`! Validation failed for ${tFile.fileName}: ${err.message}. Skipping.`);
                    continue;
                }

                testContent = this.repairImports(testContent, flowName, safeName);

                console.log(`\n=== GENERATED TEST: ${tFile.fileName} ===`);
                console.log(testContent);
                console.log("=====================================\n");

                const flowFileName = `${shortSafeName}_${tFile.fileName.replace(".js", "")}_${timestamp}.spec.js`;
                const finalPath = fileService.saveCustomTest(flowFileName, testContent);
                
                console.log(`-> Test saved: ${finalPath}`);
                lastSavedPath = finalPath;
            }

            // ═══════════════════════════════════════════════════════════════
            // BATCH GENERATE REMAINING NEGATIVE SCENARIOS (Before auto-run)
            // ═══════════════════════════════════════════════════════════════
            
            // Extract scenario IDs that were already generated in the initial NegativeScenarios file
            const negativeTestFile = testFiles.find(f => f.fileName.includes('NegativeScenarios'));
            let alreadyGeneratedIds = [];
            if (negativeTestFile) {
                // Extract all TC-AUTO-X and TC-HYBRID-X IDs from the initial test content
                const testIdMatches = negativeTestFile.content.match(/test\('(TC-(?:AUTO|HYBRID)-\d+):/g);
                if (testIdMatches) {
                    alreadyGeneratedIds = testIdMatches.map(m => m.match(/TC-(?:AUTO|HYBRID)-\d+/)[0]);
                    console.log(`-> [Batch Gen] Initial NegativeScenarios already has: ${alreadyGeneratedIds.join(', ')}`);
                }
            }
            
            // Filter out scenarios that were already generated
            const negativeScenarios = existingScenarios.filter(s => 
                s.scenarioId && 
                s.scenarioId.startsWith('TC-AUTO-') && 
                s.scenarioId !== 'TC-AUTO-1' &&
                s.Status !== 'skip' &&
                !alreadyGeneratedIds.includes(s.scenarioId) &&
                // Filter out positive/success scenarios from negative testing
                !s.scenario.toLowerCase().includes('successful') &&
                !s.scenario.toLowerCase().includes('successfully') &&
                !s.scenario.toLowerCase().includes('success')
            );

            if (negativeScenarios.length > 0) {
                console.log(`\n-> [Batch Gen] Found ${negativeScenarios.length} remaining negative scenarios to automate.`);
                await this.generateNegativeScenariosInBatches(
                    negativeScenarios,
                    flowName,
                    safeName,
                    startUrl,
                    domContext,
                    shortSafeName,
                    timestamp,
                    flowContext
                );
            } else {
                console.log(`\n-> [Batch Gen] All negative scenarios already generated in initial phase.`);
            }

            // Now auto-run the generated tests
            for (const tFile of testFiles) {
                const flowFileName = `${shortSafeName}_${tFile.fileName.replace(".js", "")}_${timestamp}.spec.js`;
                console.log(`\n-> AUTO-RUN test: ${flowFileName}`);
                try {
                    execSync(
                        `npx playwright test "tests/${flowFileName}" --headed`,
                        { stdio: "inherit", cwd: process.cwd() }
                    );
                } catch (e) {
                    console.error(`-> Execution failed for ${flowFileName}`);
                }
            }

            return lastSavedPath;

        } catch (e) {
            console.error(
                "-> Flow Gen Error:",
                e.message
            );

            fs.writeFileSync(
                "debug_failed_parse.txt",
                e.stack || e.message,
                "utf8"
            );

            return null;
        }
    }

    /**
     * Generate test automation for negative scenarios in batches of 5
     */
    async generateNegativeScenariosInBatches(scenarios, flowName, safeName, startUrl, domContext, shortSafeName, timestamp, flowContext) {
        const batchSize = 5;
        const pageClass = `${flowName}Page`;
        const verifClass = `${flowName}Verif`;
        
        // Filter out positive scenarios (scenarios that test success cases)
        const negativeKeywords = ['invalid', 'incorrect', 'wrong', 'empty', 'missing', 'error', 'fail', 'exceed', 'special character', 'unauthorized', 'restricted'];
        const positiveKeywords = ['successful', 'successfully', 'success', 'logs in', 'can log', 'able to'];
        
        const filteredScenarios = scenarios.filter(s => {
            const scenarioLower = s.scenario.toLowerCase();
            
            // Skip if it contains positive keywords
            if (positiveKeywords.some(keyword => scenarioLower.includes(keyword))) {
                console.log(`-> [Filter] Skipping positive scenario: ${s.scenarioId} - ${s.scenario}`);
                return false;
            }
            
            // Include if it contains negative keywords OR doesn't contain positive keywords
            return true;
        });
        
        console.log(`-> [Batch Gen] Filtered ${scenarios.length} scenarios to ${filteredScenarios.length} negative scenarios`);
        
        if (filteredScenarios.length === 0) {
            console.log(`-> [Batch Gen] No negative scenarios to generate`);
            return;
        }
        
        // Load recorded locators for accurate selectors
        const capturedLocators = fileService.readLocators(safeName);
        const locatorsContext = capturedLocators.length > 0 
            ? `\n\nRECORDED LOCATORS (Use these exact selectors):\n${JSON.stringify(capturedLocators, null, 2)}`
            : "";
        
        // Read existing page object to get available methods WITH their full signatures
        const pageFilePath = path.join(fileService.pagesDir, `${pageClass}.js`);
        let availableMethods = [];
        let pageMethodSignatures = [];
        if (fs.existsSync(pageFilePath)) {
            const pageContent = fs.readFileSync(pageFilePath, 'utf8');
            // Extract full method signatures: async methodName(param1, param2)
            const methodMatches = pageContent.matchAll(/async\s+(\w+)\s*\(([^)]*)\)/g);
            for (const m of methodMatches) {
                const methodName = m[1];
                const params = m[2].trim();
                availableMethods.push(methodName);
                pageMethodSignatures.push({ name: methodName, params });
            }
            console.log(`-> [Batch Gen] Available page methods: ${pageMethodSignatures.map(m => `${m.name}(${m.params})`).join(', ')}`);
        }
        
        // Read existing verification object to get available methods WITH their full signatures
        const verifFilePath = path.join(fileService.verificationDir, `${verifClass}.js`);
        let availableVerifMethods = [];
        let verifMethodSignatures = [];
        if (fs.existsSync(verifFilePath)) {
            const verifContent = fs.readFileSync(verifFilePath, 'utf8');
            const methodMatches = verifContent.matchAll(/async\s+(\w+)\s*\(([^)]*)\)/g);
            for (const m of methodMatches) {
                const methodName = m[1];
                const params = m[2].trim();
                availableVerifMethods.push(methodName);
                verifMethodSignatures.push({ name: methodName, params });
            }
            console.log(`-> [Batch Gen] Available verification methods: ${verifMethodSignatures.map(m => `${m.name}(${m.params})`).join(', ')}`);
        }

        // Build a detailed method guide that shows exact signatures and warns about parameterless methods
        const buildMethodsContext = (signatures, objName, inheritedMethods) => {
            if (signatures.length === 0) return "";

            const lines = signatures.map(m => {
                const sig = `${m.name}(${m.params})`;
                if (!m.params) {
                    // No parameters — warn AI not to pass arguments to this method
                    return `- ${objName}.${sig}  ← NO PARAMETERS: this method has hardcoded values inside. Do NOT call it with arguments like ${objName}.${m.name}('value') — that silently ignores your input. Use fillInput/clickElement directly instead if you need custom values.`;
                }
                return `- ${objName}.${sig}`;
            });

            return `\n\nAVAILABLE PAGE METHODS — EXACT SIGNATURES (CRITICAL: read parameters carefully):\n${lines.join('\n')}\n\n${inheritedMethods}\n\nCRITICAL METHOD USAGE RULE:\n- If a method has NO parameters (e.g., login()), it uses hardcoded values internally. NEVER call it with arguments.\n- For scenarios that need custom credentials or data, use fillInput(selector, value) and clickElement(selector) directly.\n- Only call a method with arguments if its signature actually declares those parameters.`;
        };

        const buildVerifContext = (signatures, objName) => {
            if (signatures.length === 0) return "";
            const lines = signatures.map(m => `- ${objName}.${m.name}(${m.params})`);
            return `\n\nAVAILABLE VERIFICATION METHODS — EXACT SIGNATURES:\n${lines.join('\n')}\n\nInherited from CommonVerifications:\n- ${objName}.verifyURL(url)\n- ${objName}.verifyURLContains(text)\n- ${objName}.verifyElementVisible(selector)\n- ${objName}.verifyErrorVisible()\n- ${objName}.verifyPageContains(text)`;
        };

        const methodsContext = buildMethodsContext(
            pageMethodSignatures,
            'pageObj',
            `Inherited from CommonMethods (always available):\n- pageObj.navigateToUrl(url)\n- pageObj.fillInput(selector, value)\n- pageObj.clickElement(selector)\n- pageObj.isVisible(selector)`
        );

        const verifMethodsContext = buildVerifContext(verifMethodSignatures, 'verifObj');
        
        for (let i = 0; i < filteredScenarios.length; i += batchSize) {
            const batch = filteredScenarios.slice(i, i + batchSize);
            const batchNum = Math.floor(i / batchSize) + 1;
            
            console.log(`\n-> [Batch ${batchNum}] Generating tests for scenarios ${i + 1}-${Math.min(i + batch.length, filteredScenarios.length)} of ${filteredScenarios.length}...`);

            const batchPrompt = `
Generate STRICT VALID Playwright test code for these ${batch.length} negative test scenarios.
Return ONLY raw test blocks - NO JSON wrapper, NO markdown fences, NO explanations.

Page Class: ${pageClass}
Verification Class: ${verifClass}
Start URL: ${startUrl}

Recorded Journey Sequence (Follow these steps to reach deep pages):
${JSON.stringify(flowContext, null, 2)}

Scenarios to Automate (Generate ONE test for EACH scenario):
${JSON.stringify(batch, null, 2)}

DOM Context (use for finding selectors):
${domContext.substring(0, 10000)}${locatorsContext}${methodsContext}${verifMethodsContext}

CRITICAL RULES:
1. Generate EXACTLY ${batch.length} test blocks - one for each scenario in the list above
2. Each test MUST start with: test('SCENARIO_ID: scenario description', async ({ page }) => {
   Example: test('${batch[0].scenarioId}: ${batch[0].scenario}', async ({ page }) => {
3. STRING SAFETY (CRITICAL):
   - NEVER use apostrophes (') in test titles or strings
   - Use "does not" instead of "doesn't", "cannot" instead of "can't"
   - NEVER use possessive forms with apostrophes (use "system" not "system's", "user" not "user's")
   - Always use double quotes for strings with special characters
   - Example: test('TC-AUTO-1: To verify user cannot login', ...) ✓
   - Example: test('TC-AUTO-1: To verify user can't login', ...) ✗ WRONG
   - Example: test('TC-AUTO-1: To verify the system response', ...) ✓
   - Example: test('TC-AUTO-1: To verify the system's response', ...) ✗ WRONG
4. Instantiate at the start of EACH test:
   const pageObj = new ${pageClass}(page);
   const verifObj = new ${verifClass}(page);
5. PREREQUISITE NAVIGATION (MANDATORY):
   - Every test MUST start with: await page.goto('${startUrl}');
   - If a scenario happened on a different page (check "targetUrl" in scenario list or use the Recorded Journey), you MUST first perform the necessary steps (login, clicks) to reach that page.
   - Use your defined methods (e.g., pageObj.login(), pageObj.navigateToPractice()) to reach the target state.
   - Example: For a Contact form scenario, you MUST login and click the Contact menu before filling the form.
6. End each test with: updateScenarioStatus('SCENARIO_ID', 'passed', 'NA');
7. TEST LOGIC (CRITICAL - NO POSITIVE TESTS IN NEGATIVE FILE):
   - NEGATIVE tests should test FAILURE scenarios (invalid input, errors, edge cases)
   - NEVER create positive/success tests in NegativeScenarios file
   - If scenario says "verify successful login" - SKIP IT, it's not a negative test
   - If scenario says "verify that a user logs in successfully" - SKIP IT
   - If scenario says "verify error" or "invalid" or "empty" or "incorrect" - CORRECT for negative testing
   - Test should EXPECT errors, not success
   - Use verifObj.verifyErrorVisible() for negative tests
   - DO NOT navigate away from the page and then try to verify the previous page
   - DO NOT close the browser during the test
   - Stay on the same page or error page after the negative action
8. VERIFICATION METHODS (CRITICAL - NO HALLUCINATION):
   - For negative tests, use ONLY: verifyErrorVisible(), verifyURLContains(), verifyPageContains()
   - PREFER verifyURLContains(text) over verifyURLPattern(regex) - more flexible
   - NEVER use verifyElementVisible() with invented selectors
   - NEVER invent CSS classes like '.success-message', '.error-message', 'selector-for-element'
   - If you need to verify an error, use: await verifObj.verifyErrorVisible() (no arguments)
   - If you need to verify URL, use: await verifObj.verifyURLContains('expected-text-in-url')
   - DO NOT create verification methods that wait for elements that don't exist
9. METHOD USAGE (CRITICAL — READ SIGNATURES BEFORE CALLING):
   - BEFORE calling any method, check its signature in the AVAILABLE PAGE METHODS list above.
   - If a method has NO parameters (e.g., login()), it has hardcoded values inside. NEVER call it with arguments like pageObj.login('user', 'pass') — the arguments are silently ignored and the hardcoded values run instead.
   - For scenarios that need custom credentials or test data (invalid username, empty password, etc.), use fillInput() and clickElement() directly — do NOT call a parameterless method.
   - CORRECT: await pageObj.fillInput('#username', 'invalidUser'); await pageObj.fillInput('#password', 'Password123'); await pageObj.clickElement('#submit');
   - WRONG: await pageObj.login('invalidUser', 'Password123'); // login() has no params, ignores your values!
   - Only call a method with arguments if its signature in the list above actually declares those parameters.
   - DO NOT invent new methods like enterUsername(), enterPassword(), clickSubmit()
   - For inherited methods, you can always use: navigateToUrl(url), fillInput(selector, value), clickElement(selector)
10. Use SPECIFIC selectors from RECORDED LOCATORS or DOM:
   - Prefer: #id > [name="name"] > getByRole('link', {name: 'Text'}) > getByText('Text')
   - NEVER use generic CSS like 'div:nth-of-type(1) > p > a'
10. For error scenarios:
   - Call: await verifObj.verifyErrorVisible() (no arguments)
   - Or: await verifObj.verifyElementVisible('#error')
11. NEVER call page.locator() directly in test code - always use pageObj or verifObj methods
12. NEVER override base class methods - use inherited methods directly
13. OUTPUT FORMAT (CRITICAL):
    - Return ONLY raw test blocks
    - NO JSON wrapper
    - NO markdown fences (no \`\`\`javascript or \`\`\`)
    - NO explanations or comments
    - Just pure test() blocks one after another

IMPORTANT: Generate ALL ${batch.length} tests. Do not skip any scenario.

Output format (raw test blocks only):
test('TC-AUTO-X: ...', async ({ page }) => {
  const pageObj = new ${pageClass}(page);
  const verifObj = new ${verifClass}(page);
  await page.goto('${startUrl}');
  // Use fillInput/clickElement directly for custom test data — do NOT call parameterless methods with arguments
  await pageObj.fillInput('#username', 'invalidUser');
  await pageObj.fillInput('#password', 'wrongPass');
  await pageObj.clickElement('#submit');
  await verifObj.verifyErrorVisible();
  updateScenarioStatus('TC-AUTO-X', 'passed', 'NA');
});

test('TC-AUTO-Y: ...', async ({ page }) => {
  // ... next test ...
});
`;

            try {
                let responseText = await aiService.callAIWithFallback(batchPrompt);
                responseText = responseText.replace(/```javascript/gi, "").replace(/```js/gi, "").replace(/```/g, "").trim();

                // Fix common string issues that cause syntax errors
                // Replace apostrophes in test titles with proper alternatives
                responseText = responseText.replace(/test\('([^']+)',/g, (match, title) => {
                    // Remove all apostrophes from the title
                    const fixed = title
                        .replace(/can't/g, 'cannot')
                        .replace(/doesn't/g, 'does not')
                        .replace(/won't/g, 'will not')
                        .replace(/isn't/g, 'is not')
                        .replace(/aren't/g, 'are not')
                        .replace(/wasn't/g, 'was not')
                        .replace(/weren't/g, 'were not')
                        .replace(/haven't/g, 'have not')
                        .replace(/hasn't/g, 'has not')
                        .replace(/hadn't/g, 'had not')
                        .replace(/shouldn't/g, 'should not')
                        .replace(/wouldn't/g, 'would not')
                        .replace(/couldn't/g, 'could not')
                        .replace(/don't/g, 'do not')
                        .replace(/didn't/g, 'did not')
                        // Remove possessive apostrophes (user's → user, system's → system)
                        .replace(/(\w+)'s\b/g, '$1')
                        // Remove any remaining apostrophes
                        .replace(/'/g, '');
                    return `test('${fixed}',`;
                });

                // Count how many tests were generated
                const testCount = (responseText.match(/test\(/g) || []).length;
                console.log(`-> [Batch ${batchNum}] AI generated ${testCount} test(s) for ${batch.length} scenario(s)`);

                if (testCount < batch.length) {
                    console.warn(`-> [Batch ${batchNum}] WARNING: Expected ${batch.length} tests but got ${testCount}. Some scenarios may be missing.`);
                }

                // Append to the NegativeScenarios file
                const negativeFileName = `${shortSafeName}_NegativeScenarios.spec_${timestamp}.spec.js`;
                const negativeFilePath = path.join(fileService.testsDir, negativeFileName);

                // If this is the first batch AND file doesn't exist yet, create with imports
                if (i === 0 && !fs.existsSync(negativeFilePath)) {
                    const header = this.repairImports("", flowName, safeName);
                    fs.writeFileSync(negativeFilePath, header + "\n\n" + responseText, "utf8");
                    console.log(`-> [Batch ${batchNum}] Created ${negativeFileName} with ${testCount} test(s)`);
                } else {
                    // Append to existing file (whether from initial generation or previous batch)
                    fs.appendFileSync(negativeFilePath, "\n\n" + responseText, "utf8");
                    console.log(`-> [Batch ${batchNum}] Appended ${testCount} test(s) to ${negativeFileName}`);
                }

            } catch (err) {
                console.error(`-> [Batch ${batchNum}] Failed to generate tests:`, err.message);
            }
        }

        console.log(`\n-> [Batch Gen] Completed! Processed ${filteredScenarios.length} negative scenarios in ${Math.ceil(filteredScenarios.length / batchSize)} batch(es).`);
    }
}

module.exports = new FlowGenerator();