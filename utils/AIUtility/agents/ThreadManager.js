const fs = require('fs');
const path = require('path');

/**
 * ThreadManager.js — Manages persistent chat threads for agents
 * 
 * Features:
 * - Persist thread history across program restarts
 * - Automatic context transfer when thread is full
 * - Never lose instruction context
 * - Thread rotation with context preservation
 */

class ThreadManager {
    constructor(agentId) {
        this.agentId = agentId;
        this.threadsDir = path.join(__dirname, '..', '..', '..', 'agents', 'threads');
        this.threadFile = path.join(this.threadsDir, `${agentId}-thread.json`);
        this.maxHistoryLength = 50; // Max messages before rotation
        
        // Ensure threads directory exists
        if (!fs.existsSync(this.threadsDir)) {
            fs.mkdirSync(this.threadsDir, { recursive: true });
        }
        
        this.thread = this._loadThread();
    }

    /**
     * Load existing thread or create new one
     */
    _loadThread() {
        if (fs.existsSync(this.threadFile)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.threadFile, 'utf8'));
                console.log(`-> [ThreadManager] Loaded existing thread: ${data.history.length} messages`);
                return data;
            } catch (error) {
                console.warn(`-> [ThreadManager] Failed to load thread, creating new one`);
            }
        }
        
        console.log(`-> [ThreadManager] Creating new thread`);
        return {
            agentId: this.agentId,
            createdAt: new Date().toISOString(),
            history: [],
            totalCalls: 0,
            totalTokens: 0,
            rotationCount: 0
        };
    }

    /**
     * Save thread to disk
     */
    _saveThread() {
        try {
            fs.writeFileSync(this.threadFile, JSON.stringify(this.thread, null, 2));
        } catch (error) {
            console.error(`-> [ThreadManager] Failed to save thread:`, error.message);
        }
    }

    /**
     * Get chat history for Gemini
     */
    getHistory() {
        return this.thread.history;
    }

    /**
     * Add message to history - with Smart Summarization to save tokens
     */
    addMessage(role, content, tokens = 0) {
        let storageContent = content;

        // SMART SUMMARIZATION: If the model outputs a large JSON array, 
        // we "Forget the Data" but "Keep the Pattern" by saving only a summary.
        if (role === 'model' && content.trim().startsWith('[') && content.length > 500) {
            try {
                const data = JSON.parse(content);
                if (Array.isArray(data)) {
                    const count = data.length;
                    const firstScenario = data[0]?.scenario || 'Unknown';
                    // We save a Pattern-Preserving Summary instead of the raw data
                    storageContent = `[SYSTEM NOTE: Successfully generated ${count} scenarios. Pattern Example: "${firstScenario}". Data forgotten to save tokens.]`;
                    console.log(`-> [ThreadManager] Data forgotten, pattern preserved (${count} scenarios summary stored).`);
                }
            } catch (e) {
                // If parsing fails, store a truncated preview
                storageContent = content.substring(0, 200) + "... [Data truncated for token efficiency]";
            }
        }

        this.thread.history.push({
            role,
            parts: [{ text: storageContent }]
        });
        
        this.thread.totalCalls++;
        this.thread.totalTokens += tokens;
        
        this._saveThread();
    }

    /**
     * Check if thread needs rotation (too many messages)
     */
    needsRotation() {
        return this.thread.history.length >= this.maxHistoryLength;
    }

    /**
     * Clear thread: summarize context and start fresh
     * This preserves the conversation context without losing the agent's "memory"
     */
    async rotateThread(genAI, model, systemInstruction) {
        console.log(`-> [ThreadManager] Thread full (${this.thread.history.length} messages), rotating...`);
        
        // Create summary of recent context
        const recentMessages = this.thread.history.slice(-10); // Last 10 messages
        const contextSummary = this._createContextSummary(recentMessages);
        
        // Backup old thread (NEVER lose training data)
        const backupFile = path.join(
            this.threadsDir, 
            `${this.agentId}-thread-backup-${Date.now()}.json`
        );
        fs.writeFileSync(backupFile, JSON.stringify(this.thread, null, 2));
        console.log(`-> [ThreadManager] Training data backed up to: ${path.basename(backupFile)}`);
        
        // Create new thread with context summary (preserves learning)
        this.thread.history = [
            {
                role: 'user',
                parts: [{ text: `[Context from previous thread - Training preserved]\n${contextSummary}\n\n[Continuing with learned patterns...]` }]
            }
        ];
        
        this.thread.rotationCount++;
        this._saveThread();
        
        console.log(`-> [ThreadManager] Thread rotated (rotation #${this.thread.rotationCount}) - Training preserved`);
        
        // Return new chat session with preserved context
        const geminiModel = genAI.getGenerativeModel({
            model,
            systemInstruction,
            generationConfig: {
                maxOutputTokens: 131072,
                temperature: 0.2
            }
        });
        
        return geminiModel.startChat({ history: this.thread.history });
    }

    /**
     * Create context summary from recent messages
     */
    _createContextSummary(messages) {
        const summary = messages.map((msg, idx) => {
            const role = msg.role === 'user' ? 'User' : 'Agent';
            const text = msg.parts[0].text;
            const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;
            return `${idx + 1}. ${role}: ${preview}`;
        }).join('\n\n');
        
        return `Recent conversation history (your training data):\n\n${summary}\n\nYou have learned patterns from previous interactions. Continue applying these learned patterns to maintain consistency and quality.`;
    }

    /**
     * Get thread statistics
     */
    getStats() {
        return {
            agentId: this.agentId,
            createdAt: this.thread.createdAt,
            totalCalls: this.thread.totalCalls,
            totalTokens: this.thread.totalTokens,
            historyLength: this.thread.history.length,
            rotationCount: this.thread.rotationCount,
            needsRotation: this.needsRotation()
        };
    }

    /**
     * Archive current thread and start fresh (NEVER deletes - always backs up)
     * Use this only when you want to start completely fresh training
     */
    archiveAndReset() {
        console.log(`-> [ThreadManager] Archiving current thread...`);
        
        // Always backup before resetting (NEVER lose training data)
        if (this.thread.history.length > 0) {
            const archiveFile = path.join(
                this.threadsDir, 
                `${this.agentId}-thread-archive-${Date.now()}.json`
            );
            fs.writeFileSync(archiveFile, JSON.stringify(this.thread, null, 2));
            console.log(`-> [ThreadManager] Training data archived to: ${path.basename(archiveFile)}`);
        }
        
        // Create fresh thread
        this.thread = {
            agentId: this.agentId,
            createdAt: new Date().toISOString(),
            history: [],
            totalCalls: 0,
            totalTokens: 0,
            rotationCount: 0
        };
        
        this._saveThread();
        console.log(`-> [ThreadManager] Fresh thread created (old training archived)`);
    }

    /**
     * Restore thread from backup
     */
    restoreFromBackup(backupFileName) {
        const backupFile = path.join(this.threadsDir, backupFileName);
        
        if (!fs.existsSync(backupFile)) {
            throw new Error(`Backup file not found: ${backupFileName}`);
        }
        
        const backupData = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
        this.thread = backupData;
        this._saveThread();
        
        console.log(`-> [ThreadManager] Thread restored from: ${backupFileName}`);
        console.log(`-> [ThreadManager] Restored ${this.thread.history.length} messages`);
    }

    /**
     * List all available backups
     */
    listBackups() {
        const files = fs.readdirSync(this.threadsDir)
            .filter(f => f.startsWith(`${this.agentId}-thread-`) && f.endsWith('.json'))
            .filter(f => f !== `${this.agentId}-thread.json`); // Exclude current thread
        
        return files.map(file => {
            const stats = fs.statSync(path.join(this.threadsDir, file));
            const data = JSON.parse(fs.readFileSync(path.join(this.threadsDir, file), 'utf8'));
            
            return {
                fileName: file,
                createdAt: data.createdAt,
                messages: data.history.length,
                totalCalls: data.totalCalls,
                totalTokens: data.totalTokens,
                fileSize: stats.size,
                lastModified: stats.mtime
            };
        }).sort((a, b) => b.lastModified - a.lastModified);
    }
}

module.exports = ThreadManager;
