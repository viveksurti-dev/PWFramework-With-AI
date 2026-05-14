require('dotenv').config();
const ScenarioAgent = require('../utils/AIUtility/agents/ScenarioAgent');

async function testQuality() {
    const agent = new ScenarioAgent();
    await agent.initialize();

    const mockMetadata = {
        formName: "Advanced Registration",
        fields: [
            {
                id: "userType",
                label: "User Type",
                type: "dropdown",
                options: ["Proprietor", "Partner", "Company"]
            },
            {
                id: "gender",
                label: "Gender",
                type: "radio",
                options: ["Male", "Female"]
            },
            {
                id: "country",
                label: "Country",
                type: "dropdown",
                options: ["India", "USA"],
                hasChild: true
            },
            {
                id: "state",
                label: "State",
                type: "dropdown",
                parent: "country",
                options: ["Maharashtra", "Delhi", "New York", "California"]
            },
            {
                id: "pancard",
                label: "PAN Card Number",
                type: "text",
                validation: "pattern: [A-Z]{5}[0-9]{4}[A-Z]{1}"
            }
        ]
    };

    console.log("-> [Test] Triggering High-Capacity Generation...");
    const scenarios = await agent.generate({
        page: "Mock_Advanced_Registration",
        url: "https://example.com/register",
        metadata: mockMetadata,
        mode: "e2e"
    });

    console.log("\n" + "=".repeat(50));
    console.log(`RESULTS: ${scenarios.length} Scenarios Generated`);
    console.log("=".repeat(50));

    // Check for Combinatorial Matrix
    const combos = scenarios.filter(s => s.category === "Happy Path" && (s.scenario.includes("Proprietor") || s.scenario.includes("Partner")));
    console.log(`-> Combinatorial Coverage: Found ${combos.length} specific path scenarios.`);

    // Check for Dependencies
    const dependencies = scenarios.filter(s => s.scenario.toLowerCase().includes("country") || s.scenario.toLowerCase().includes("state"));
    console.log(`-> Dependency Coverage: Found ${dependencies.length} cascading logic scenarios.`);

    // Check for English Only
    const nonEnglish = scenarios.filter(s => /[^\x00-\x7F]/.test(JSON.stringify(s)));
    console.log(`-> English Check: ${nonEnglish.length === 0 ? "PASSED (100% English)" : "FAILED (Non-English detected)"}`);

    console.log("\nSAMPLE SCENARIO (Combinatorial):");
    console.log(JSON.stringify(combos[0], null, 2));

    console.log("\nSAMPLE SCENARIO (Negative/Boundary):");
    const negative = scenarios.find(s => s.category.toLowerCase().includes("negative") || s.scenario.toLowerCase().includes("invalid"));
    console.log(JSON.stringify(negative, null, 2));

    process.exit(0);
}

testQuality().catch(err => {
    console.error(err);
    process.exit(1);
});
