const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const aiService = require("./AiEngine");
const fileService = require("./FileHandler");
const config = require("../config/UtilityConfig");
const CodeRepair = require("../Scenario_Creation/CodeRepair");

// ── Prompt builder is selected based on test mode ─────────────────────────────
// Default to E2E since FlowGenerator is only called for hybrid/integration flows
let _promptBuilder = require("../Scenario_Creation/PromptBuilder_EndToEnd");

class FlowGenerator {
    constructor() {
        this.flowRunning = false;
        this.currentGeneration = null;
    }

    /**
     * Sets the test mode — called by AutomationManager when user selects mode.
     * @param {'unit'|'e2e'} mode
     */
    setTestMode(mode) {
        _promptBuilder = mode === 'unit'
            ? require("../Scenario_Creation/PromptBuilder_Unit")
            : require("../Scenario_Creation/PromptBuilder_EndToEnd");
        console.log(`-> [FlowGenerator] Prompt builder set to: ${mode.toUpperCase()}`);
    }

    getTestCodeContent(testCodeData) {
        if (!testCodeData) return null;
        if (typeof testCodeData === "string") return testCodeData;
        if (testCodeData.content) return testCodeData.content;
        const values = Object.values(testCodeData);
        return values.length ? String(values[0]) : null;
    }

    normalizeFiles(filesData) {
        return CodeRepair.normalizeFiles(filesData);
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

            console.log(`âœ“ Created ${pageClass}.js`);
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

            console.log(`âœ“ Created ${verifClass}.js`);
        }

        return { pageClass, verifClass };
    }

    repairImports(code, flowName, safeName) {
        return CodeRepair.repairImports(code, flowName, safeName);
    }

    validateGeneratedTest(code) {
        return CodeRepair.validateGeneratedTest(code);
    }

    repairTruncatedJson(jsonStr) {
        return CodeRepair.repairTruncatedJson(jsonStr);
    }

    parseAIResponse(responseText) {
        return CodeRepair.parseAIResponse(responseText);
    }

    sanitizeTestTitles(code) {
        return CodeRepair.sanitizeTestTitles(code);
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

            // 4. Load Existing Scenarios for ID Mapping ONLY
            // IMPORTANT: In E2E mode we only pass scenarioId + a short title for ID tracking.
            // We do NOT pass testData, selectors, or page-specific details from previous pages.
            // Passing full scenario objects causes the AI to reuse login-page selectors/fields
            // on unrelated pages (e.g. dashboard, profile) — the "cross-page bleed" bug.
            const scenariosPath = fileService.getMemoryPath(safeName);
            let existingScenarios = [];
            if (fs.existsSync(scenariosPath)) {
                try {
                    const raw = JSON.parse(fs.readFileSync(scenariosPath, "utf8"));
                    // Strip everything except ID + short title — no testData, no selectors, no page context
                    existingScenarios = raw.map(s => ({
                        scenarioId: s.scenarioId,
                        scenario:   (s.scenario || "").substring(0, 60)
                    }));
                    console.log(`-> [Flow Gen] Loaded ${existingScenarios.length} scenario IDs for tracking (stripped page-specific data).`);
                } catch (e) {}
            }

            const { pageClass, verifClass } =
                this.ensureBaseFiles(flowName);

            // 5. Load DOM Context + extract structured metadata for each step
            // Metadata replaces raw DOM in the prompt — 94% fewer tokens, 100% of useful info.
            // Raw DOM kept as fallback only (trimmed to 500 chars) for selector reference.
            let domContext = "";
            let domMetadata = null; // aggregated metadata across all pages in the journey

            if (Array.isArray(flowContext)) {
                const DomMetadataExtractor = require("../Scenario_Creation/DomMetadataExtractor");
                const allPageMetadata = [];

                for (const step of flowContext) {
                    if (step.stepName) {
                        const html = fileService.getLayoutHtml(step.stepName);
                        if (html) {
                            // Extract structured metadata — this is what goes into the prompt
                            try {
                                const pageMeta = DomMetadataExtractor.extract(html);
                                pageMeta._url = step.url || step.stepName;
                                allPageMetadata.push(pageMeta);
                                console.log(`-> [Metadata] Extracted from ${step.stepName}: ${pageMeta.inputs.length} inputs, ${pageMeta.dropdowns.length} dropdowns, ${pageMeta.dependencies.length} dependencies`);
                            } catch (e) {
                                console.warn(`-> [Metadata] Extraction failed for ${step.stepName}: ${e.message}`);
                            }

                            // Keep a tiny raw DOM snippet as fallback for selector hints only
                            const trimmed = fileService.trimDomForPrompt(html, 500);
                            domContext += `\n--- DOM snippet: ${step.url} ---\n${trimmed}\n`;
                        }
                    }
                }

                // Merge metadata across all pages — deduplicate by field name
                if (allPageMetadata.length > 0) {
                    domMetadata = {
                        pages: allPageMetadata.map(m => ({
                            url:          m._url,
                            pageInfo:     m.pageInfo,
                            inputs:       m.inputs,
                            dropdowns:    m.dropdowns,
                            radioGroups:  m.radioGroups,
                            checkboxes:   m.checkboxes,
                            buttons:      m.buttons,
                            validations:  m.validations,
                            dependencies: m.dependencies,
                        }))
                    };
                    const totalInputs      = allPageMetadata.reduce((s, m) => s + m.inputs.length, 0);
                    const totalDropdowns   = allPageMetadata.reduce((s, m) => s + m.dropdowns.length, 0);
                    const totalDeps        = allPageMetadata.reduce((s, m) => s + m.dependencies.length, 0);
                    const totalValidations = allPageMetadata.reduce((s, m) => s + m.validations.length, 0);
                    console.log(`-> [Metadata] Total across journey: ${totalInputs} inputs, ${totalDropdowns} dropdowns, ${totalDeps} dependencies, ${totalValidations} validation rules`);
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

            const prompt = _promptBuilder.buildHybridFlowPrompt({
                flowName,
                startUrl,
                pageClass,
                verifClass,
                flowContext,
                capturedData,
                domMetadata,
                sanitizedLocators: sanitizedLocators.map(loc => {
                    const l = loc.locators || {};
                    return {
                        type:       loc.type,
                        url:        loc.url,
                        text:       loc.text || l.innerText || null,
                        // Ranked strategy arrays — AI uses these in priority order
                        playwright: l.playwright  || [],
                        aria:       l.ariaList    || l.aria || [],
                        textList:   l.textList    || l.text || [],
                        cssList:    l.cssList     || l.css  || [],
                        xpathList:  l.xpathList   || l.xpath || [],
                        // Flat fallbacks for backward compat
                        id:         l.id          || null,
                        ariaLabel:  l.ariaLabel   || null,
                        testId:     l.testId      || null,
                        placeholder:l.placeholder || null,
                        textXPath:  l.textXPath   || (l.textList || [])[0] || null,
                    };
                }),
                domContext,
                commonMethodsContext,
                commonVerifContext,
                existingScenarios: fileService.trimScenariosForPrompt(existingScenarios)
            });

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

                // â”€â”€ Content/filename mismatch guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                // Detect when AI writes the wrong class into the wrong file
                // e.g. a Verif class saved into a Page file, or vice-versa
                const contentHasVerifClass = /class\s+\w+Verif\b/.test(f.content);
                const contentHasPageClass  = /class\s+\w+Page\b/.test(f.content);

                if (!isVerification && contentHasVerifClass && !contentHasPageClass) {
                    console.error(`âŒ MISMATCH: ${f.fileName} is a Page file but contains a Verif class. Skipping to prevent overwriting the real page object.`);
                    continue;
                }
                if (isVerification && contentHasPageClass && !contentHasVerifClass) {
                    console.error(`âŒ MISMATCH: ${f.fileName} is a Verif file but contains a Page class. Skipping to prevent overwriting the real verif object.`);
                    continue;
                }

                // Validate page files are not empty (must have methods beyond constructor)
                if (!isVerification) {
                    const methodsCount = (f.content.match(/async\s+\w+\s*\(/g) || []).length;
                    if (methodsCount === 0) {
                        console.error(`âŒ ERROR: ${f.fileName} has NO interaction methods!`);
                        console.error(`âŒ AI failed to generate methods for this page. Skipping this file to preserve existing code.`);
                        continue; 
                    }
                }

                // Validate verification files are not empty
                if (isVerification) {
                    const hasOnlyConstructor = f.content.includes('constructor') && 
                                              !f.content.match(/async\s+verify[A-Z]/);
                    if (hasOnlyConstructor) {
                        console.error(`âŒ ERROR: ${f.fileName} has no verification methods!`);
                        console.error(`âŒ AI failed to generate verification methods. Skipping this file.`);
                        continue; 
                    }
                }
                
                fs.writeFileSync(
                    path.join(targetDir, f.fileName),
                    f.content,
                    "utf8"
                );

                console.log(`âœ“ ${isVerification ? "Verification" : "Page"}: ${f.fileName}`);
            }

            const testFiles = this.normalizeFiles(aiResult.testCode);
            
            console.log(`-> [Debug] Normalized ${testFiles.length} test file(s): ${testFiles.map(f => f.fileName).join(', ')}`);
            
            // Debug: Check if any test file content contains JSON structure
            for (const tf of testFiles) {
                if (tf.content && (tf.content.includes('"pageFiles"') || tf.content.includes('"verificationFiles"'))) {
                    console.error(`âŒ ERROR: Test file '${tf.fileName}' contains JSON structure instead of code!`);
                    console.error(`âŒ This means the AI response was not parsed correctly.`);
                    console.error(`âŒ First 500 chars of content: ${tf.content.substring(0, 500)}`);
                    
                    // Try to extract just the test code if it's embedded
                    const testCodeMatch = tf.content.match(/(import.*?test\(.*?\n\}\);)/s);
                    if (testCodeMatch) {
                        console.log(`-> [Debug] Attempting to extract test code from JSON structure...`);
                        tf.content = testCodeMatch[1];
                    } else {
                        console.error(`âŒ Could not extract test code. Skipping this file.`);
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
                                console.warn(`âš ï¸  WARNING: Verification checks for '${urlFragment}' but this doesn't appear in the recorded journey!`);
                                console.warn(`âš ï¸  Journey URLs: ${journeyUrls.join(', ')}`);
                                console.warn(`âš ï¸  This test will likely fail. The AI may have hallucinated a URL.`);
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

                // â”€â”€ Selector validation: check generated selectors against saved DOM â”€â”€
                if (domContext) {
                    const invalidSelectors = config.validateSelectors(testContent, domContext);
                    if (invalidSelectors.length > 0) {
                        console.warn(`-> [Validation] âš ï¸ ${invalidSelectors.length} selector(s) not found in DOM:`);
                        invalidSelectors.forEach(s => console.warn(`   Line ${s.line}: ${s.selector}`));
                    } else {
                        console.log(`-> [Validation] âœ… All selectors verified against DOM`);
                    }
                }

                lastSavedPath = finalPath;
            }

            // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            // BATCH GENERATE REMAINING NEGATIVE SCENARIOS (Before auto-run)
            // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            
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
            // Note: existingScenarios is already stripped to {scenarioId, scenario} only —
            // no Status/testData fields. Use the raw file for status-based filtering.
            let rawExistingScenarios = [];
            if (fs.existsSync(scenariosPath)) {
                try {
                    rawExistingScenarios = JSON.parse(fs.readFileSync(scenariosPath, "utf8"));
                } catch (e) {}
            }

            const negativeScenarios = rawExistingScenarios.filter(s => {
                if (!s.scenarioId) return false;
                if (s.Status === 'skip') return false;
                if (alreadyGeneratedIds.includes(s.scenarioId)) return false;

                const text = (s.scenario || '').toLowerCase();

                // Exclude clearly positive/success scenarios
                const isPositive =
                    text.includes('successful') ||
                    text.includes('successfully') ||
                    (text.includes('success') && !text.includes('unsuccessful')) ||
                    text.includes('logs in') ||
                    text.includes('can log') ||
                    text.includes('able to');
                if (isPositive) return false;

                // Include if it contains any negative signal
                const negativeSignals = [
                    'invalid', 'incorrect', 'wrong', 'empty', 'missing', 'error',
                    'fail', 'fails', 'failure', 'exceed', 'special character',
                    'unauthorized', 'restricted', 'blocked', 'rejected', 'reject',
                    'blocked when', 'is blocked', 'submission is blocked',
                    'submission fails', 'submission blocked', 'stale', 'incomplete',
                    'without selecting', 'without entering', 'left empty', 'left blank',
                    'outside allowed', 'outside permitted', 'exceeds', 'duplicate',
                    'incompatible', 'missing consent', 'missing captcha'
                ];
                return negativeSignals.some(sig => text.includes(sig));
            });

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
                    flowContext,
                    domMetadata
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
    async generateNegativeScenariosInBatches(scenarios, flowName, safeName, startUrl, domContext, shortSafeName, timestamp, flowContext, domMetadata) {
        const batchSize = 5;
        const pageClass = `${flowName}Page`;
        const verifClass = `${flowName}Verif`;
        
        // Identify negative scenarios by content — keyword-based, framework-agnostic
        const negativeSignals = [
            'invalid', 'incorrect', 'wrong', 'empty', 'missing', 'error',
            'fail', 'fails', 'failure', 'exceed', 'special character',
            'unauthorized', 'restricted', 'blocked', 'rejected', 'reject',
            'blocked when', 'is blocked', 'submission is blocked',
            'submission fails', 'submission blocked', 'stale', 'incomplete',
            'without selecting', 'without entering', 'left empty', 'left blank',
            'outside allowed', 'outside permitted', 'exceeds', 'duplicate',
            'incompatible', 'missing consent', 'missing captcha'
        ];
        const positiveKeywords = ['successful', 'successfully', 'logs in', 'can log', 'able to'];

        const filteredScenarios = scenarios.filter(s => {
            const scenarioLower = s.scenario.toLowerCase();

            // Skip clearly positive scenarios
            if (positiveKeywords.some(keyword => scenarioLower.includes(keyword))) {
                console.log(`-> [Filter] Skipping positive scenario: ${s.scenarioId} - ${s.scenario.substring(0, 60)}`);
                return false;
            }

            // Keep if it has any negative signal
            return negativeSignals.some(sig => scenarioLower.includes(sig));
        });
        
        console.log(`-> [Batch Gen] Filtered ${scenarios.length} scenarios to ${filteredScenarios.length} negative scenarios`);
        
        if (filteredScenarios.length === 0) {
            console.log(`-> [Batch Gen] No negative scenarios to generate`);
            return;
        }
        
        // Load recorded locators for accurate selectors — keep only the 5 most useful fields
        const capturedLocators = fileService.readLocators(safeName);
        const locatorsContext = capturedLocators.length > 0 
            ? `\n\nRECORDED LOCATORS (use these exact selectors):\n${JSON.stringify(
                capturedLocators.map(loc => ({
                    type: loc.type,
                    url: loc.url,
                    text: loc.text || loc.innerText || null,
                    id: loc.id || (loc.locators && loc.locators.id) || null,
                    textXPath: (loc.locators && loc.locators.textXPath) || null
                })), null, 2)}`
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
                    // No parameters â€” warn AI not to pass arguments to this method
                    return `- ${objName}.${sig}  â† NO PARAMETERS: this method has hardcoded values inside. Do NOT call it with arguments like ${objName}.${m.name}('value') â€” that silently ignores your input. Use fillInput/clickElement directly instead if you need custom values.`;
                }
                return `- ${objName}.${sig}`;
            });

            return `\n\nAVAILABLE PAGE METHODS â€” EXACT SIGNATURES (CRITICAL: read parameters carefully):\n${lines.join('\n')}\n\n${inheritedMethods}\n\nCRITICAL METHOD USAGE RULE:\n- If a method has NO parameters (e.g., login()), it uses hardcoded values internally. NEVER call it with arguments.\n- For scenarios that need custom credentials or data, use fillInput(selector, value) and clickElement(selector) directly.\n- Only call a method with arguments if its signature actually declares those parameters.`;
        };

        const buildVerifContext = (signatures, objName) => {
            if (signatures.length === 0) return "";
            const lines = signatures.map(m => `- ${objName}.${m.name}(${m.params})`);
            return `\n\nAVAILABLE VERIFICATION METHODS â€” EXACT SIGNATURES:\n${lines.join('\n')}\n\nInherited from CommonVerifications:\n- ${objName}.verifyURL(url)\n- ${objName}.verifyURLContains(text)\n- ${objName}.verifyElementVisible(selector)\n- ${objName}.verifyErrorVisible()\n- ${objName}.verifyPageContains(text)`;
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

            const batchPrompt = _promptBuilder.buildNegativeBatchPrompt({
                batch,
                pageClass,
                verifClass,
                startUrl,
                domMetadata,
                domContext,
                locatorsContext,
                methodsContext,
                verifMethodsContext
            });

            try {
                let responseText = await aiService.callAI(batchPrompt, null);
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
                        // Remove possessive apostrophes (user's â†’ user, system's â†’ system)
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
