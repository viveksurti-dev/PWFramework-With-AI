'use strict';

const fs = require('fs');
const path = require('path');

/**
 * MarkdownExporter.js
 * 
 * Converts raw JSON scenarios into beautiful, human-readable Markdown reports.
 */
class MarkdownExporter {
    /**
     * Generates a Markdown report from an array of scenarios.
     * @param {string} sessionName - The name of the session (safeName)
     * @param {Array} scenarios - The scenarios array
     * @param {string} targetDir - Where to save the MD file
     */
    static export(sessionName, scenarios, targetDir) {
        if (!scenarios || scenarios.length === 0) return;

        const timestamp = new Date().toLocaleString();
        let md = `# AI Test Scenarios Report: ${sessionName}\n`;
        md += `> **Generated on:** ${timestamp}\n`;
        md += `> **Total Scenarios:** ${scenarios.length}\n\n`;

        md += `## 📋 Scenario Matrix\n\n`;
        md += `| ID | Category | Scenario | Steps Count |\n`;
        md += `|----|----------|----------|-------------|\n`;

        scenarios.forEach(s => {
            md += `| ${s.scenarioId} | ${s.category} | ${s.scenario} | ${s.testSteps ? s.testSteps.length : 0} |\n`;
        });

        md += `\n---\n\n`;

        md += `## 📝 Detailed Scenarios\n\n`;

        scenarios.forEach(s => {
            md += `### [${s.scenarioId}] ${s.scenario}\n`;
            md += `**Category:** ${s.category}  \n`;
            if (s.module) md += `**Module:** ${s.module}  \n`;
            
            md += `\n**Test Steps:**\n`;
            if (s.testSteps && s.testSteps.length > 0) {
                s.testSteps.forEach((step, idx) => {
                    md += `${idx + 1}. ${step}\n`;
                });
            } else {
                md += `*No steps provided*\n`;
            }

            md += `\n**Test Data:**\n`;
            md += `\`\`\`json\n${JSON.stringify(s.testData || {}, null, 2)}\n\`\`\`\n`;
            
            if (s.expectedResult) {
                md += `\n**Expected Result:**\n> ${s.expectedResult}\n`;
            }

            md += `\n---\n`;
        });

        const fileName = `${sessionName}_scenarios_report.md`;
        const filePath = path.join(targetDir, fileName);

        try {
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            fs.writeFileSync(filePath, md, 'utf8');
            console.log(`-> [Exporter] ✅ Human-readable report saved: ${filePath}`);
        } catch (err) {
            console.error(`-> [Exporter] ⚠ Failed to save MD report: ${err.message}`);
        }
    }
}

module.exports = MarkdownExporter;
