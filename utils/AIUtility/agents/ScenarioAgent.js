const AgentManager = require('./AgentManager');

/**
 * ScenarioAgent.js — High-level interface for scenario generation
 * 
 * Usage:
 *   const agent = new ScenarioAgent();
 *   const scenarios = await agent.generate({ metadata, mode: 'e2e' });
 */

class ScenarioAgent {
    constructor() {
        this.manager = new AgentManager();
        this.agent = null;
        this.initialized = false;
    }

    /**
     * Initialize the agent (loads permanent agent)
     */
    async initialize() {
        if (this.initialized) {
            return;
        }

        console.log('\n-> [ScenarioAgent] Initializing...');
        this.agent = await this.manager.load('scenario-agent');
        this.initialized = true;
        console.log('-> [ScenarioAgent] Ready!\n');
    }

    /**
     * Provide feedback to the agent for learning
     * The agent will remember this feedback and apply it to future generations
     * 
     * @param {string} feedback - Feedback message
     * @returns {Promise<string>} Agent's acknowledgment
     */
    async provideFeedback(feedback) {
        if (!this.initialized) {
            await this.initialize();
        }

        console.log(`-> [ScenarioAgent] Receiving feedback: "${feedback}"`);

        const result = await this.agent.execute(feedback);
        
        console.log(`-> [ScenarioAgent] Feedback acknowledged`);
        
        return result.text;
    }

    /**
     * Generate test scenarios
     * 
     * @param {object} input
     * @param {string} input.page - Page name
     * @param {string} input.url - Page URL
     * @param {object} input.metadata - Page metadata (fields, validations, dependencies)
     * @param {string} input.screenshot - Optional base64 screenshot for visual context
     * @param {string} input.mode - 'unit' or 'e2e'
     * @returns {Promise<Array>} Array of scenario objects
     */    async generate(input) {
        if (!this.initialized) {
            await this.initialize();
        }

        console.log(`\n-> [ScenarioAgent] 🚀 Starting High-Capacity Generation for: ${input.page || input.url}`);
        const startTime = Date.now();

        try {
            // Build the unified "Super Prompt" for all scenario types
            const prompt = this._buildPrompt({
                ...input,
                combinationsHint: "Generate a MASSIVE EXHAUSTIVE suite (30-50+ scenarios) covering: 1. EVERY combination in the Combinatorial Matrix, 2. Cascading Dependencies, 3. Cross-Field Logic, and 4. Aggressive Negative cases."
            });

            const result = await this.agent.execute(prompt, input.screenshot, false);
            
            let scenarios = this._parseScenarios(result.text);

            // Enrich scenarios with metadata
            scenarios = scenarios.map(s => ({
                ...s,
                testData: s.testData || this._extractTestDataFromTitle(s.scenario)
            }));

            // Final Deduplication
            const finalScenarios = this._deduplicateScenarios(scenarios);
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            
            console.log(`\n-> [ScenarioAgent] 🏆 Exhaustive Suite Generated: ${finalScenarios.length} scenarios in ${duration}s`);
            
            // Reset context after full page generation to keep prompt lean
            this.archiveAndReset(); 
            
            return finalScenarios;

        } catch (error) {
            console.error(`   ⚠ [ScenarioAgent] Generation failed: ${error.message}`);
            return [];
        }
    }

    _parseScenarios(text) {
        try {
            let scenarios = [];

            // ── Stage 1: Markdown Block Extraction ──────────────────────────
            // AI often wraps multiple parts in separate ```json blocks
            const blockPattern = /```json\s*([\s\S]*?)```/g;
            let match;
            while ((match = blockPattern.exec(text)) !== null) {
                const blockContent = match[1].trim();
                try {
                    const fixed = this._fixStringConcatenation(blockContent);
                    const parsed = JSON.parse(fixed);
                    if (Array.isArray(parsed)) scenarios = scenarios.concat(parsed);
                    else scenarios.push(parsed);
                } catch (e) {
                    // If block parse fails, try to salvage individual objects from it
                    const salvaged = this._extractPartialScenarios(blockContent);
                    if (salvaged.length > 0) scenarios = scenarios.concat(salvaged);
                }
            }

            if (scenarios.length > 0) return scenarios;

            // ── Stage 2: Brute-Force Structural Extraction ─────────────────
            let startIdx = Math.min(
                text.indexOf('[') === -1 ? Infinity : text.indexOf('['), 
                text.indexOf('{') === -1 ? Infinity : text.indexOf('{')
            );
            let endIdx = Math.max(
                text.lastIndexOf(']'), 
                text.lastIndexOf('}')
            );

            if (startIdx !== Infinity && endIdx !== -1 && endIdx > startIdx) {
                const jsonCore = text.substring(startIdx, endIdx + 1);
                try {
                    const fixed = this._fixStringConcatenation(jsonCore);
                    const parsed = JSON.parse(fixed);
                    
                    if (!Array.isArray(parsed) && typeof parsed === 'object') {
                        const keys = Object.keys(parsed);
                        for (const key of keys) {
                            if (Array.isArray(parsed[key])) return parsed[key];
                        }
                        return [parsed];
                    }
                    if (Array.isArray(parsed)) return parsed;
                } catch (e) {}
            }

            // ── Stage 3: Deep Object Salvage ──────────────────────────────
            scenarios = this._extractPartialScenarios(text);
            if (scenarios.length > 0) {
                console.log(`-> [Self-Heal] Successfully salvaged ${scenarios.length} scenarios from fragmented text.`);
                return scenarios;
            }

            throw new Error("No valid JSON scenarios found in response");

        } catch (error) {
            // Self-Heal: Keep the console clean by only showing the minimal recovery error
            console.warn(`   ⚠ [Self-Heal] Recovery failed for this block: ${error.message.split('\n')[0]}`);
            
            // Silently save debug info in the background without noisy logs
            try {
                const fs = require('fs');
                const path = require('path');
                const debugPath = path.join(__dirname, '..', '..', '..', 'debug-agent-response.txt');
                fs.writeFileSync(debugPath, text);
            } catch (fsErr) {}

            throw new Error(`JSON format invalid after healing attempts.`);
        }
    }

    /**
     * Internal Prompt Builder - Simplifies the architecture by removing external dependencies.
     */
    _buildPrompt(input) {
        const { page, url, metadata, mode, combinationsHint, existingIds, negativeUrlChecklist } = input;
        
        const negativeUrls = negativeUrlChecklist && negativeUrlChecklist.length > 0 
            ? negativeUrlChecklist 
            : [url];
        
        return `Generate STRATEGIC test scenarios for the following ${mode.toUpperCase()} context.
        
Analyze the ATTACHED SCREENSHOT to understand visual groupings and logical field relationships.

URL: ${url}
PAGE: ${page}

METADATA:
${JSON.stringify(metadata, null, 2)}

${combinationsHint ? `STRATEGIC FOCUS:\n${combinationsHint}` : ''}

${existingIds && existingIds.length > 0 ? `PREVIOUSLY GENERATED IDs (Do NOT duplicate these missions):\n${existingIds.join(', ')}` : ''}

MANDATORY NEGATIVE CHECKLIST:
Focus on Equivalence Partitioning and Cross-field logic for these targets:
${negativeUrls.map(u => `- ${u}`).join('\n')}

REMEMBER:
1. Apply Senior QA analysis: Equivalence Partitioning & Boundary Analysis.
2. Return ONLY a structured JSON array with: { scenarioId, category, scenario, testSteps, testData }.
3. Ensure every scenario has logical 'testSteps' explaining the verification flow.
4. Reply with ONLY valid JSON.`;
    }

    /**
     * Fix malformed strings in JSON (Loose quotes, concat, repeat)
     */
    _fixStringConcatenation(text) {
        if (!text) return text;
        
        let fixed = text;

        // 1. Handle .repeat() pattern sometimes used for long strings
        const repeatPattern = /"\s*\+\s*"([A-Za-z0-9])"\s*\.repeat\((\d+)\)\s*\+\s*"/g;
        fixed = fixed.replace(repeatPattern, (match, char, count) => {
            const num = parseInt(count);
            return num > 1000 ? `[${num} ${char} characters]` : char.repeat(num);
        });

        // 2. Join split strings: "Part 1" + "Part 2" -> "Part 1Part 2"
        fixed = fixed.replace(/"\s*\+\s*"/g, '');

        // 3. Sanitize colloquial AI abbreviations like "... [repeated 500 times]"
        fixed = fixed.replace(/\.\.\.\s*\[repeated\s+\d+\s+times\]/gi, ' (Long String)');
        fixed = fixed.replace(/\.\.\.\s*\[truncated\]/gi, ' (Truncated)');
        
        // 3. Repair unescaped internal quotes (Loose quotes)
        // Match a value start ': "' followed by content and a value end '"[,}]'
        // This regex looks for quotes INSIDE that range that aren't preceded by a backslash
        fixed = fixed.replace(/:\s*"([\s\S]*?)"\s*([,}])/g, (match, content, suffix) => {
            const escapedContent = content.replace(/(?<!\\)"/g, '\\"');
            return `: "${escapedContent}"${suffix}`;
        });

        return fixed;
    }

    /**
     * Extract partial scenarios from malformed JSON
     */
    _extractPartialScenarios(text) {
        const scenarios = [];
        // More flexible pattern: Match anything that looks like a scenario object
        // (Must contain scenarioId and scenario/testSteps)
        const scenarioPattern = /\{\s*"scenarioId":\s*"[^"]*"[\s\S]*?(?:"scenario"|"testSteps"):[\s\S]*?\}/g;
        
        let match;
        while ((match = scenarioPattern.exec(text)) !== null) {
            try {
                let fixed = match[0]
                    .replace(/,(\s*})/g, '$1')
                    .replace(/\n/g, ' ')
                    .replace(/\r/g, '')
                    .replace(/\t/g, ' ');
                
                fixed = this._fixStringConcatenation(fixed);
                const scenario = JSON.parse(fixed);
                if (scenario.scenarioId && (scenario.scenario || scenario.testSteps)) {
                    scenarios.push(scenario);
                }
            } catch (e) {}
        }
        return scenarios;
    }

    _extractTestDataFromTitle(scenarioTitle) {
        const testData = {};
        if (!scenarioTitle) return testData;
        const parts = scenarioTitle.split(/\s+and\s+|\s*,\s*|\s+with\s+/i);
        for (const part of parts) {
            const match = part.match(/([a-zA-Z0-9\s/]+) (?:as|is) ['"\[]?([^'"\]]+)['"\]]?/i);
            if (match) {
                let key = match[1].trim().replace(/^(To verify|successful|submission|clicking|the|for|selection|field)\s+/i, '');
                let val = match[2].trim().replace(/\.$/, '');
                testData[key] = val;
            }
        }
        return testData;
    }

    _deduplicateScenarios(scenarios) {
        const seen = new Set();
        return scenarios.filter(s => {
            const normalized = (s.scenario || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
            if (seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
        });
    }

    getStats() {
        return this.agent ? this.agent.getStats() : null;
    }

    close() {
        if (this.agent) {
            this.agent.close();
            this.initialized = false;
        }
    }

    archiveAndReset() {
        if (this.agent && this.agent.archiveAndReset) {
            this.agent.archiveAndReset();
            console.log('-> [ScenarioAgent] Thread archived, starting fresh');
        }
    }

    restoreFromBackup(backupFileName) {
        if (this.agent && this.agent.restoreFromBackup) {
            this.agent.restoreFromBackup(backupFileName);
            console.log(`-> [ScenarioAgent] Thread restored from: ${backupFileName}`);
        }
    }

    listBackups() {
        return (this.agent && this.agent.listBackups) ? this.agent.listBackups() : [];
    }
}

module.exports = ScenarioAgent;
