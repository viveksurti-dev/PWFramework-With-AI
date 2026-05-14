const AgentManager = require('./AgentManager');

/**
 * CodeAgent.js — High-level interface for automation code generation
 */
class CodeAgent {
    constructor() {
        this.manager = new AgentManager();
        this.agent = null;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        console.log('\n-> [CodeAgent] Initializing Automation Architect...');
        this.agent = await this.manager.load('code-agent');
        this.initialized = true;
        console.log('-> [CodeAgent] Ready for code generation!\n');
    }

    /**
     * Generate 3-Tier POM code for a scenario
     * 
     * @param {object} input
     * @param {object} input.scenario - The scenario object (id, title, testData)
     * @param {object} input.metadata - DOM metadata
     * @param {string} input.pageName - Name of the page
     * @param {string} input.url - URL of the page
     * @returns {Promise<object>} Object containing pageCode, verifCode, specCode
     */
    async generateCode(input) {
        if (!this.initialized) await this.initialize();

        const { scenario, metadata, pageName, url, error } = input;
        
        const mode = error ? "SELF-HEALING" : "INITIAL GENERATION";
        console.log(`-> [CodeAgent] [${mode}] Generating POM code for: ${scenario.scenarioId || 'Batch'}`);

        const prompt = `
GENERATE 3-TIER POM CODE FOR:
MODE: ${mode}
SCENARIO: ${JSON.stringify(scenario, null, 2)}
URL: ${url}
PAGE NAME: ${pageName}

${error ? `FAILURE CONTEXT:
The previous test failed with this error:
${error}
Please analyze the DOM metadata and rewrite the code to fix this specific failure.` : ''}

DOM METADATA (Use these selectors!):
${JSON.stringify(metadata, null, 2)}
        `.trim();

        const startTime = Date.now();
        const result = await this.agent.execute(prompt, null, false);
        const codePackage = this._parseCodeResponse(result.text);
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`-> [CodeAgent] Code generated successfully in ${duration}s`);

        return codePackage;
    }

    _parseCodeResponse(text) {
        try {
            let cleaned = text.trim();

            // ── Robust JSON Extraction ────────────────────────────────────────
            // Find the start of the JSON object. We look for '{' followed by '"'
            // to ensure we catch the actual data and not conversational text.
            let startIdx = cleaned.search(/\{\s*"/);
            const endIdx = cleaned.lastIndexOf('}');

            if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                cleaned = cleaned.substring(startIdx, endIdx + 1);
            }

            if (cleaned.startsWith('```json')) {
                cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '');
            } else if (cleaned.startsWith('```')) {
                cleaned = cleaned.replace(/```\n?/g, '');
            }

            return JSON.parse(cleaned);
        } catch (error) {
            console.error(`-> [CodeAgent] Failed to parse code response: ${error.message}`);
            // If JSON parsing fails, try to extract manually (fallback)
            return {
                error: "Failed to parse AI response",
                raw: text
            };
        }
    }
}

module.exports = CodeAgent;
