const fs = require('fs');
const path = require('path');

/**
 * UsageAnalyzer.js — Analyze AI usage logs and generate statistics
 */

class UsageAnalyzer {
    constructor(logFilePath) {
        this.logFilePath = logFilePath || path.join(__dirname, '..', '..', '..', 'logs', 'ai_usage.log');
        this.entries = [];
    }

    /**
     * Parse the log file
     */
    parseLog() {
        if (!fs.existsSync(this.logFilePath)) {
            throw new Error(`Log file not found: ${this.logFilePath}`);
        }

        const content = fs.readFileSync(this.logFilePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());

        this.entries = lines.map(line => {
            // Parse: [AI Usage][2026-05-13 11:00:58 IST] gemini-2.5-flash | prompt: 116221 | output: 1761 | total: 122250
            // Also handles optional " tokens" suffix for backward compatibility
            const match = line.match(/\[AI Usage\]\[(.+?)\] (.+?) \| prompt: (\d+)(?:\s*tokens)? \| output: (\d+)(?:\s*tokens)? \| total: (\d+)(?:\s*tokens)?/);
            
            if (match) {
                const [, timestamp, model, prompt, output, total] = match;
                const date = timestamp.split(' ')[0]; // Extract date part
                
                return {
                    timestamp,
                    date,
                    model,
                    promptTokens: parseInt(prompt),
                    outputTokens: parseInt(output),
                    totalTokens: parseInt(total)
                };
            }
            return null;
        }).filter(entry => entry !== null);

        return this.entries;
    }

    /**
     * Calculate daily statistics
     */
    getDailyStats() {
        const dailyStats = {};

        this.entries.forEach(entry => {
            if (!dailyStats[entry.date]) {
                dailyStats[entry.date] = {
                    date: entry.date,
                    calls: 0,
                    promptTokens: 0,
                    outputTokens: 0,
                    totalTokens: 0,
                    models: {}
                };
            }

            const day = dailyStats[entry.date];
            day.calls++;
            day.promptTokens += entry.promptTokens;
            day.outputTokens += entry.outputTokens;
            day.totalTokens += entry.totalTokens;

            // Track model usage
            if (!day.models[entry.model]) {
                day.models[entry.model] = 0;
            }
            day.models[entry.model]++;
        });

        return Object.values(dailyStats).sort((a, b) => b.date.localeCompare(a.date));
    }

    /**
     * Calculate overall average
     */
    getAverageUsage() {
        const dailyStats = this.getDailyStats();
        const totalDays = dailyStats.length;

        if (totalDays === 0) return null;

        const totals = dailyStats.reduce((acc, day) => ({
            calls: acc.calls + day.calls,
            promptTokens: acc.promptTokens + day.promptTokens,
            outputTokens: acc.outputTokens + day.outputTokens,
            totalTokens: acc.totalTokens + day.totalTokens
        }), { calls: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0 });

        return {
            avgCallsPerDay: Math.round(totals.calls / totalDays),
            avgPromptTokensPerDay: Math.round(totals.promptTokens / totalDays),
            avgOutputTokensPerDay: Math.round(totals.outputTokens / totalDays),
            avgTotalTokensPerDay: Math.round(totals.totalTokens / totalDays),
            totalDays,
            totalCalls: totals.calls,
            totalPromptTokens: totals.promptTokens,
            totalOutputTokens: totals.outputTokens,
            totalTokens: totals.totalTokens
        };
    }

    /**
     * Get model usage breakdown
     */
    getModelBreakdown() {
        const modelStats = {};

        this.entries.forEach(entry => {
            if (!modelStats[entry.model]) {
                modelStats[entry.model] = {
                    calls: 0,
                    totalTokens: 0
                };
            }
            modelStats[entry.model].calls++;
            modelStats[entry.model].totalTokens += entry.totalTokens;
        });

        return Object.entries(modelStats)
            .map(([model, stats]) => ({ model, ...stats }))
            .sort((a, b) => b.totalTokens - a.totalTokens);
    }

    /**
     * Format number with commas
     */
    formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /**
     * Print detailed report
     */
    printReport() {
        this.parseLog();

        console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
        console.log('║                    AI USAGE ANALYTICS REPORT                           ║');
        console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

        // Overall Average
        const avg = this.getAverageUsage();
        if (!avg) {
            console.log('No usage data found.');
            return;
        }

        console.log('📊 OVERALL STATISTICS');
        console.log('─'.repeat(76));
        console.log(`Total Days Tracked    : ${avg.totalDays}`);
        console.log(`Total API Calls       : ${this.formatNumber(avg.totalCalls)}`);
        console.log(`Total Tokens Used     : ${this.formatNumber(avg.totalTokens)}`);
        console.log(`  - Prompt Tokens     : ${this.formatNumber(avg.totalPromptTokens)}`);
        console.log(`  - Output Tokens     : ${this.formatNumber(avg.totalOutputTokens)}`);
        console.log('─'.repeat(76));
        console.log();

        console.log('📈 DAILY AVERAGE USAGE');
        console.log('─'.repeat(76));
        console.log(`Avg API Calls/Day     : ${this.formatNumber(avg.avgCallsPerDay)}`);
        console.log(`Avg Total Tokens/Day  : ${this.formatNumber(avg.avgTotalTokensPerDay)}`);
        console.log(`  - Avg Prompt/Day    : ${this.formatNumber(avg.avgPromptTokensPerDay)}`);
        console.log(`  - Avg Output/Day    : ${this.formatNumber(avg.avgOutputTokensPerDay)}`);
        console.log('─'.repeat(76));
        console.log();

        // Daily Breakdown
        const dailyStats = this.getDailyStats();
        console.log('📅 DAILY BREAKDOWN');
        console.log('─'.repeat(76));
        console.log('Date       | Calls | Prompt Tokens | Output Tokens | Total Tokens');
        console.log('─'.repeat(76));
        
        dailyStats.forEach(day => {
            console.log(
                `${day.date} | ${String(day.calls).padEnd(5)} | ` +
                `${this.formatNumber(day.promptTokens).padEnd(13)} | ` +
                `${this.formatNumber(day.outputTokens).padEnd(13)} | ` +
                `${this.formatNumber(day.totalTokens)}`
            );
        });
        console.log('─'.repeat(76));
        console.log();

        // Model Breakdown
        const modelBreakdown = this.getModelBreakdown();
        console.log('🤖 MODEL USAGE BREAKDOWN');
        console.log('─'.repeat(76));
        console.log('Model                              | Calls | Total Tokens | % of Total');
        console.log('─'.repeat(76));
        
        modelBreakdown.forEach(model => {
            const percentage = ((model.totalTokens / avg.totalTokens) * 100).toFixed(1);
            console.log(
                `${model.model.padEnd(35)}| ${String(model.calls).padEnd(6)}| ` +
                `${this.formatNumber(model.totalTokens).padEnd(13)}| ${percentage}%`
            );
        });
        console.log('─'.repeat(76));
        console.log();

        // Cost Estimation (approximate)
        console.log('💰 ESTIMATED COST (Approximate)');
        console.log('─'.repeat(76));
        console.log('Based on typical pricing:');
        console.log(`  Gemini 2.5 Flash: $0.075 per 1M input, $0.30 per 1M output`);
        
        const geminiPromptCost = (avg.totalPromptTokens / 1000000) * 0.075;
        const geminiOutputCost = (avg.totalOutputTokens / 1000000) * 0.30;
        const totalCost = geminiPromptCost + geminiOutputCost;
        
        console.log(`  Total Estimated Cost: $${totalCost.toFixed(2)}`);
        console.log(`  Daily Average Cost  : $${(totalCost / avg.totalDays).toFixed(2)}`);
        console.log('─'.repeat(76));
        console.log();

        // Peak Usage Day
        const peakDay = dailyStats.reduce((max, day) => 
            day.totalTokens > max.totalTokens ? day : max
        );
        
        console.log('🔥 PEAK USAGE DAY');
        console.log('─'.repeat(76));
        console.log(`Date          : ${peakDay.date}`);
        console.log(`API Calls     : ${peakDay.calls}`);
        console.log(`Total Tokens  : ${this.formatNumber(peakDay.totalTokens)}`);
        console.log(`Models Used   : ${Object.keys(peakDay.models).join(', ')}`);
        console.log('─'.repeat(76));
        console.log();
    }

    /**
     * Export report to JSON
     */
    exportToJSON(outputPath) {
        this.parseLog();

        const report = {
            generatedAt: new Date().toISOString(),
            overall: this.getAverageUsage(),
            dailyStats: this.getDailyStats(),
            modelBreakdown: this.getModelBreakdown()
        };

        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
        console.log(`\n✅ Report exported to: ${outputPath}\n`);
    }
}

module.exports = UsageAnalyzer;

// CLI usage
if (require.main === module) {
    const analyzer = new UsageAnalyzer();
    
    try {
        analyzer.printReport();
        
        // Ask if user wants to export
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        rl.question('Export report to JSON? (y/n): ', (answer) => {
            if (answer.toLowerCase() === 'y') {
                const outputPath = path.join(__dirname, '..', '..', '..', 'reports', 'ai_usage_report.json');
                const dir = path.dirname(outputPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                analyzer.exportToJSON(outputPath);
            }
            rl.close();
        });
        
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}
