'use strict';

/**
 * CodeRepair.js — Code sanitization, validation, and repair utilities.
 *
 * Extracted from FlowGenerator.js for better separation of concerns.
 * Handles:
 * - Test title sanitization (apostrophes, possessives)
 * - Import repair (strips AI-generated imports, injects correct boilerplate)
 * - JSON response parsing (structured + regex fallback)
 * - Generated test validation (placeholder detection, test block check)
 * - Truncated JSON repair
 */

const fs = require('fs');
const path = require('path');
const fileService = require('../services/FileHandler');

const CodeRepair = {

    /**
     * Sanitize test title strings to remove apostrophes and possessives
     * that would break single-quoted JS strings.
     *
     * @param {string} code - Generated test code
     * @returns {string} Sanitized code
     */
    sanitizeTestTitles(code) {
        if (!code) return code;

        const fixTitle = (title) => title
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
            .replace(/(\w+)'s\b/g,   '$1')
            .replace(/'/g,           '');

        return code.replace(
            /(test(?:\.describe)?)\s*\(\s*(['"])([\s\S]*?)\2/g,
            (match, fn, quote, title) => {
                const fixed = fixTitle(title);
                return `${fn}('${fixed}'`;
            }
        );
    },

    /**
     * Strips AI-generated imports and prepends correct boilerplate
     * (imports, helpers, updateScenarioStatus, test.afterEach).
     *
     * @param {string} code     - Raw AI-generated test code
     * @param {string} flowName - Sanitized flow name (PascalCase)
     * @param {string} safeName - URL-safe name for file paths
     * @returns {string} Repaired code with correct imports
     */
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

        // Fix wrong import paths from AI
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

function categorizeError(msg) {
    if (!msg) return 'unknown';
    const m = msg.toLowerCase();
    if (m.includes('waiting for locator') || m.includes('no element matches') || m.includes('strict mode')) return 'selector_not_found';
    if (m.includes('timeout') || m.includes('exceeded') || m.includes('timed out')) return 'timeout';
    if (m.includes('captcha') || m.includes('decrypt')) return 'captcha_failed';
    if (m.includes('navigation') || m.includes('net::err') || m.includes('page.goto')) return 'navigation_error';
    if (m.includes('expect') || m.includes('tohaveurl') || m.includes('tobevisible')) return 'assertion_failed';
    return 'unknown';
}

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
            if (status === 'Fail') scenario.errorCategory = categorizeError(remarks);
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
        const tmpPath = scenariosFilePath + '.tmp_' + process.pid;
        fs.writeFileSync(tmpPath, JSON.stringify(scenarios, null, 2));
        fs.renameSync(tmpPath, scenariosFilePath);
    } catch(e) {}
}

test.afterEach(async ({ }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
        const scenarioIdMatch = testInfo.title.match(/^(TC-(?:AUTO|HYBRID)-\\\\d+)/);
        if (scenarioIdMatch) {
            updateScenarioStatus(scenarioIdMatch[1], 'Fail', testInfo.error ? testInfo.error.message : 'Failed');
        }
    }
});
`;

        code = helperCode + "\n" + code.trim();

        // Fix page class instantiation without page argument
        code = code.replace(
            new RegExp(`new\\s+${pageClass}\\s*\\(\\s*\\)`, "g"),
            `new ${pageClass}(page)`
        );

        return code;
    },

    /**
     * Validates generated test code for common issues.
     * Throws an Error if validation fails.
     *
     * @param {string} code - Generated test code
     * @throws {Error} If placeholders or missing test blocks are detected
     */
    validateGeneratedTest(code) {
        const issues = [];

        if (/\n\s*\.\.\.\s*\n/.test(code))
            issues.push("Placeholder detected");

        if (!code.includes("test(") && !code.includes("test.describe("))
            issues.push("No test block");

        if (issues.length) {
            throw new Error(issues.join(", "));
        }
    },

    /**
     * Attempts to repair truncated JSON from AI responses.
     *
     * @param {string} jsonStr - Potentially truncated JSON string
     * @returns {string} Repaired JSON string
     */
    repairTruncatedJson(jsonStr) {
        if (!jsonStr) return jsonStr;

        // Count open/close braces and brackets
        let openBraces = (jsonStr.match(/{/g) || []).length;
        let closeBraces = (jsonStr.match(/}/g) || []).length;
        let openBrackets = (jsonStr.match(/\[/g) || []).length;
        let closeBrackets = (jsonStr.match(/]/g) || []).length;

        // Remove trailing comma if present
        jsonStr = jsonStr.replace(/,\s*$/, '');

        // Close unclosed strings (if last char is not a quote and we're inside a string)
        if (jsonStr.match(/:\s*"[^"]*$/)) {
            jsonStr += '"';
        }

        // Add missing closing braces/brackets
        while (closeBraces < openBraces) { jsonStr += '}'; closeBraces++; }
        while (closeBrackets < openBrackets) { jsonStr += ']'; closeBrackets++; }

        return jsonStr;
    },

    /**
     * Parses AI response text into structured {pageFiles, verificationFiles, testCode}.
     * Tries JSON parsing first, then regex extraction, then raw code fallback.
     *
     * @param {string} responseText - Raw AI response
     * @returns {{pageFiles: object, verificationFiles: object, testCode: object}}
     */
    parseAIResponse(responseText) {
        let cleanJson = responseText?.trim() || "";
        cleanJson = fileService.repairJsonArray(cleanJson);

        // 1. Try structured JSON parsing
        try {
            const firstBrace = cleanJson.indexOf("{");
            const lastBrace = cleanJson.lastIndexOf("}");

            if (firstBrace !== -1 && lastBrace !== -1) {
                const potentialJson = cleanJson.slice(firstBrace, lastBrace + 1);
                const parsed = JSON.parse(potentialJson);

                if (parsed.testCode || parsed.pageFiles || parsed.verificationFiles) {
                    return parsed;
                }
            }
        } catch (e) {
            // Not valid JSON, continue to fallback
        }

        // 2. Regex extraction for partially valid JSON
        const result = { pageFiles: {}, verificationFiles: {}, testCode: {} };
        let foundSomething = false;

        const testCodeMatches = responseText.match(/"testCode"\s*:\s*\{([\s\S]*?)\}/);
        if (testCodeMatches) {
            const block = testCodeMatches[1];
            const fileMatches = block.matchAll(/"([^"]+)"\s*:\s*"([\s\S]*?)(?="|$)/g);
            for (const m of fileMatches) {
                result.testCode[m[1]] = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                foundSomething = true;
            }
        }

        const pageFilesMatches = responseText.match(/"pageFiles"\s*:\s*\{([\s\S]*?)\}/);
        if (pageFilesMatches) {
            const block = pageFilesMatches[1];
            const fileMatches = block.matchAll(/"([^"]+)"\s*:\s*"([\s\S]*?)(?="|$)/g);
            for (const m of fileMatches) {
                result.pageFiles[m[1]] = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                foundSomething = true;
            }
        }

        const verifFilesMatches = responseText.match(/"verificationFiles"\s*:\s*\{([\s\S]*?)\}/);
        if (verifFilesMatches) {
            const block = verifFilesMatches[1];
            const fileMatches = block.matchAll(/"([^"]+)"\s*:\s*"([\s\S]*?)(?="|$)/g);
            for (const m of fileMatches) {
                result.verificationFiles[m[1]] = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                foundSomething = true;
            }
        }

        if (foundSomething) return result;

        // 3. Fallback to raw code detection
        const isRawCode = cleanJson.includes("@playwright/test") || cleanJson.includes("test(");
        if (isRawCode) {
            return { pageFiles: {}, verificationFiles: {}, testCode: { "Flow.spec.js": cleanJson } };
        }

        throw new Error("Failed to parse AI response as either valid JSON or raw Playwright code.");
    },

    /**
     * Normalizes file data from AI response into [{fileName, content}] array.
     *
     * @param {object|Array} filesData - AI response file data (object or array)
     * @returns {Array<{fileName: string, content: string}>}
     */
    normalizeFiles(filesData) {
        if (!filesData) return [];
        if (Array.isArray(filesData)) return filesData;
        if (typeof filesData === 'object') {
            return Object.entries(filesData).map(([fileName, content]) => ({
                fileName,
                content: typeof content === 'string' ? content : String(content)
            }));
        }
        return [];
    }
};

module.exports = CodeRepair;
