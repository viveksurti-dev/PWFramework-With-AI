'use strict';

/**
 * LocalScenarioGenerator.js — Token-Free Combinatorial Scenario Engine.
 * 
 * Generates the complete Cartesian product of all selectable fields locally
 * using pure JavaScript logic. This eliminates AI costs for standard combinations.
 */

class LocalScenarioGenerator {
    /**
     * Generate exhaustive combinatorial scenarios from metadata
     * 
     * @param {object} metadata - Structured metadata from DomMetadataExtractor
     * @param {string} moduleName - Name of the page/module
     * @returns {Array} Array of scenario objects
     */
    static generate(metadata, moduleName = 'Unknown') {
        console.log(`-> [LocalGenerator] Starting combinatorial generation for: ${moduleName}`);
        
        const categoricalFields = this._extractCategoricalFields(metadata);
        
        if (categoricalFields.length === 0) {
            console.log("-> [LocalGenerator] No categorical fields found. Skipping local generation.");
            return [];
        }

        // Calculate Cartesian Product (Combinations)
        const combinations = this._cartesianProduct(categoricalFields.map(f => f.options));
        console.log(`-> [LocalGenerator] Generated ${combinations.length} exhaustive combinations.`);

        const scenarios = [];

        // 1. Add Combinatorial Scenarios
        combinations.forEach((combo, idx) => {
            const testData = {};
            const titleParts = [];

            combo.forEach((value, fieldIdx) => {
                const fieldName = categoricalFields[fieldIdx].fieldName;
                testData[fieldName] = value;
                titleParts.push(`${fieldName} as ${value}`);
            });

            scenarios.push({
                scenarioId: `TC-LOCAL-COMBO-${idx + 1}`,
                module: moduleName,
                scenario: `To verify successful submission with ${titleParts.join(', ')} and default inputs.`,
                expectedResult: 'Should be successful and navigate to next page.',
                testData: testData,
                isLocal: true
            });
        });

        // 2. Add Dependency Scenarios (Fix: Offloading from AI)
        if (metadata.dependencies) {
            metadata.dependencies.forEach((dep, idx) => {
                const depScenarios = this._generateDependencyScenarios(dep, moduleName, idx);
                scenarios.push(...depScenarios);
            });
            console.log(`-> [LocalGenerator] Generated ${metadata.dependencies.length} dependency scenario groups.`);
        }

        return scenarios;
    }

    /**
     * Generates specific scenarios for different dependency types
     */
    static _generateDependencyScenarios(dep, moduleName, index) {
        const scenarios = [];
        const { type, triggerField, triggerValue, dependentFields = [], targetSection } = dep;

        if (type === 'conditional-visibility') {
            scenarios.push({
                scenarioId: `TC-LOCAL-DEP-${index}-A`,
                module: moduleName,
                scenario: `To verify ${targetSection || 'dependent section'} becomes enabled when ${triggerField} is selected as ${triggerValue}.`,
                expectedResult: `Should show ${dependentFields.join(', ')} and accept input.`,
                testData: { [triggerField]: triggerValue },
                isLocal: true
            });
            scenarios.push({
                scenarioId: `TC-LOCAL-DEP-${index}-B`,
                module: moduleName,
                scenario: `To verify ${targetSection || 'dependent section'} remains hidden when ${triggerField} is NOT ${triggerValue}.`,
                expectedResult: `Should keep ${dependentFields.join(', ')} hidden or disabled.`,
                testData: { [triggerField]: 'INVALID_OR_OTHER' }, 
                isLocal: true
            });
        } 
        else if (type === 'hierarchical') {
            scenarios.push({
                scenarioId: `TC-LOCAL-DEP-${index}-H`,
                module: moduleName,
                scenario: `To verify ${dependentFields[0] || 'child'} dropdown loads options after ${triggerField} is selected as ${triggerValue}.`,
                expectedResult: 'Should load dependent options correctly.',
                testData: { [triggerField]: triggerValue },
                isLocal: true
            });
        }
        else if (type === 'auto-population') {
            scenarios.push({
                scenarioId: `TC-LOCAL-DEP-${index}-P`,
                module: moduleName,
                scenario: `To verify ${dependentFields.join(', ')} auto-populate when ${triggerField} is triggered.`,
                expectedResult: 'Values should match source fields exactly.',
                testData: { [triggerField]: triggerValue || true },
                isLocal: true
            });
        }

        return scenarios;
    }

    /**
     * Extracts fields that have predefined options (dropdowns, radio groups)
     */
    static _extractCategoricalFields(metadata) {
        const fields = [];

        // Check dropdowns
        if (metadata.dropdowns) {
            metadata.dropdowns.forEach(d => {
                if (d.options && d.options.length > 1) {
                    fields.push({
                        fieldName: d.fieldName,
                        options: d.options
                    });
                }
            });
        }

        // Check radio groups
        if (metadata.radioGroups) {
            metadata.radioGroups.forEach(r => {
                if (r.options && r.options.length > 1) {
                    fields.push({
                        fieldName: r.fieldName,
                        options: r.options
                    });
                }
            });
        }

        // Limit to 3-4 fields to prevent "Combinatorial Explosion" (e.g. 1000+ scenarios)
        // In real apps, testing 1000 combinations in one page is usually overkill.
        return fields.slice(0, 4); 
    }

    /**
     * Recursive Cartesian Product algorithm
     */
    static _cartesianProduct(arrays) {
        return arrays.reduce((a, b) => {
            return a.flatMap(d => b.map(e => [d, e].flat()));
        }, [[]]);
    }
}

module.exports = LocalScenarioGenerator;
