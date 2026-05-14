require('dotenv').config();
const aiService = require('../utils/AIUtility/services/AiEngine');

async function runPreflight() {
    console.log("-> [Diagnostic] Starting Agent Preflight Check...\n");
    try {
        const healthyModel = await aiService.preflight();
        if (healthyModel) {
            console.log(`\n✅ PREFLIGHT SUCCESS: Primary model is ready: ${healthyModel.model}`);
        } else {
            console.error("\n❌ PREFLIGHT FAILED: No models are responding.");
        }
    } catch (e) {
        console.error(`\n❌ PREFLIGHT ERROR: ${e.message}`);
    }
}

runPreflight();
