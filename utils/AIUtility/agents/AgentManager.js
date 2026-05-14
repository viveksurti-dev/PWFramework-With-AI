const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require("openai");
const ThreadManager = require('./ThreadManager');

// ── AI Usage Logger ───────────────────────────────────────────────────────────
const AI_USAGE_LOG = path.join(__dirname, "..", "..", "..", "logs", "ai_usage.log");

function logAiUsage(model, promptTokens, outputTokens, totalTokens) {
  try {
    const logDir = path.dirname(AI_USAGE_LOG);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const ist = new Date(now.getTime() + istOffset);
    const pad = (n) => String(n).padStart(2, "0");
    const dateStr = `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
    const timeStr = `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())}`;
    const newLine = `[AI Usage][${dateStr} ${timeStr} IST] ${model} | prompt: ${promptTokens} | output: ${outputTokens} | total: ${totalTokens}\n`;
    let existingContent = fs.existsSync(AI_USAGE_LOG) ? fs.readFileSync(AI_USAGE_LOG, 'utf8') : '';
    fs.writeFileSync(AI_USAGE_LOG, newLine + existingContent);
  } catch (err) {
    console.warn(`[Usage Logger] Failed to log: ${err.message}`);
  }
}

class AgentManager {
    static instance = null;

    constructor() {
        if (AgentManager.instance) {
            return AgentManager.instance;
        }
        this.agents = new Map();
        this.agentsDir = path.join(__dirname, '..', '..', '..', 'agents');
        this.geminiKeys = [...new Set((process.env.GEMINI_API_KEY || "").split(",").map(k => k.trim()).filter(k => k))];
        this.openaiKey = (process.env.OPENAI_API_KEY || process.env.CHATGPT_API_KEY || "").trim();
        if (!fs.existsSync(this.agentsDir)) fs.mkdirSync(this.agentsDir, { recursive: true });
        this.currentGeminiKeyIndex = 0;
        
        AgentManager.instance = this;
    }

    _getGeminiKey() {
        if (this.geminiKeys.length === 0) return null;
        return this.geminiKeys[this.currentGeminiKeyIndex % this.geminiKeys.length];
    }

    _rotateGeminiKey() {
        if (this.geminiKeys.length > 1) {
            this.currentGeminiKeyIndex++;
            console.log(`-> [AgentManager] 🔄 Rotating to API key #${(this.currentGeminiKeyIndex % this.geminiKeys.length) + 1}`);
            return true;
        }
        return false;
    }

    async load(agentId) {
        if (this.agents.has(agentId)) return this.agents.get(agentId);
        const configPath = path.join(this.agentsDir, `${agentId}.json`);
        if (!fs.existsSync(configPath)) throw new Error(`Agent config not found: ${configPath}`);
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        if (config.instructions && config.instructions.endsWith('.md')) {
            const mdPath = path.join(this.agentsDir, config.instructions);
            if (fs.existsSync(mdPath)) config.instructions = fs.readFileSync(mdPath, 'utf8');
        }

        let agent = config.provider === 'openai' ? await this._createOpenAIAgent(config, configPath) : await this._createGeminiAgent(config);
        this.agents.set(agentId, agent);
        return agent;
    }

    async _createGeminiAgent(config) {
        const key = this._getGeminiKey();
        if (!key) throw new Error('GEMINI_API_KEY not found');
        return new GeminiAgent(new GoogleGenerativeAI(key), config, this);
    }

    async _createOpenAIAgent(config, configPath) {
        if (!this.openaiKey) throw new Error('OPENAI_API_KEY not found');
        const openai = new OpenAI({ apiKey: this.openaiKey });
        if (!config.assistantId) {
            const assistant = await openai.beta.assistants.create({ name: config.name, instructions: config.instructions, model: config.model || "gpt-4o-mini" });
            config.assistantId = assistant.id;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        }
        return new OpenAIAgent(openai, config);
    }
}

class OpenAIAgent {
    constructor(openai, config) { this.openai = openai; this.config = config; this.totalCalls = 0; }
    async execute(input) {
        this.totalCalls++;
        const thread = await this.openai.beta.threads.create();
        await this.openai.beta.threads.messages.create(thread.id, { role: "user", content: typeof input === 'string' ? input : JSON.stringify(input) });
        const run = await this.openai.beta.threads.runs.createAndPoll(thread.id, { assistant_id: this.config.assistantId });
        const messages = await this.openai.beta.threads.messages.list(thread.id);
        return { text: messages.data[0].content[0].text.value, usage: run.usage };
    }
    close() { console.log(`-> [Agent] ${this.config.name} closed.`); }
}

class GeminiAgent {
    constructor(genAI, config, manager) {
        this.genAI = genAI;
        this.config = config;
        this.manager = manager;
        this.chat = null;
        this.threadManager = new ThreadManager(config.id);
        this.lastCallTime = 0;
        this.currentModelIndex = 0;
        this.models = Array.isArray(config.model) ? config.model : [config.model];
    }

    _getCurrentModel() {
        return this.models[this.currentModelIndex % this.models.length];
    }

    _rotateModel() {
        if (this.models.length > 1) {
            this.currentModelIndex++;
            console.log(`-> [Agent] 🔄 Switching to fallback model: ${this._getCurrentModel()}`);
            this.chat = null; // Force new chat with new model
            return true;
        }
        return false;
    }

    async execute(input, screenshot = null, saveHistory = true, retryCount = 0) {
        try {
            const now = Date.now();
            if (this.lastCallTime > 0 && (now - this.lastCallTime) < 2000) {
                await new Promise(r => setTimeout(r, 2000 - (now - this.lastCallTime)));
            }
            this.lastCallTime = Date.now();

            let inputText = typeof input === 'string' ? input : JSON.stringify(input);
            let messageContent = inputText;
            if (typeof input === 'object' && input.metadata && input.screenshot) {
                messageContent = [{ text: inputText }, { inlineData: { mimeType: 'image/jpeg', data: input.screenshot } }];
            }

            let fullResponse = '';
            let promptTokens = 0, outputTokens = 0, totalTokens = 0;

            // ── Stateless Mode: Direct Generation ─────────────────────────────
            if (!saveHistory) {
                const model = this.genAI.getGenerativeModel({
                    model: this._getCurrentModel(),
                    systemInstruction: this.config.instructions,
                    generationConfig: this.config.config || { temperature: 0.1, topP: 0.95, topK: 40, maxOutputTokens: 150000 }
                });
                
                const result = await model.generateContent(messageContent);
                const response = await result.response;
                fullResponse = response.text();
                const usage = response.usageMetadata || {};
                promptTokens = usage.promptTokenCount || 0;
                outputTokens = usage.candidatesTokenCount || 0;
                totalTokens = usage.totalTokenCount || 0;
            } 
            // ── Stateful Mode: Chat Session ──────────────────────────────────
            else {
                if (!this.chat) {
                    const model = this.genAI.getGenerativeModel({
                        model: this._getCurrentModel(),
                        systemInstruction: this.config.instructions,
                        generationConfig: this.config.config || { temperature: 0.1, topP: 0.95, topK: 40, maxOutputTokens: 150000 }
                    });
                    this.chat = model.startChat({ history: this.threadManager.getHistory() });
                }

                let isComplete = false, continuationCount = 0;
                while (!isComplete) {
                    const result = await this.chat.sendMessage(continuationCount === 0 ? messageContent : 'Continue.');
                    const text = result.response.text();
                    const usage = result.response.usageMetadata || {};
                    fullResponse += text;
                    promptTokens += usage.promptTokenCount || 0;
                    outputTokens += usage.candidatesTokenCount || 0;
                    totalTokens += usage.totalTokenCount || 0;

                    if (this._isTruncated(text, fullResponse) && continuationCount < 3) {
                        continuationCount++;
                        this.threadManager.addMessage('user', 'Continue', 0);
                        this.threadManager.addMessage('model', text, 0);
                    } else {
                        isComplete = true;
                    }
                }
                this.threadManager.addMessage('user', inputText, 0);
                this.threadManager.addMessage('model', fullResponse, 0);
            }
            logAiUsage(this._getCurrentModel(), promptTokens, outputTokens, totalTokens);
            return { text: fullResponse, usage: { promptTokens, outputTokens, totalTokens } };

        } catch (error) {
            const errorText = error.message || "";
            
            // 1. Handle Dead Keys (403 Forbidden)
            if (errorText.includes("403") || errorText.includes("Forbidden") || errorText.includes("denied")) {
                console.error(`-> [Agent] CRITICAL: Key #${(this.manager.currentGeminiKeyIndex % this.manager.geminiKeys.length) + 1} is DEAD (403 Forbidden). Skipping permanently...`);
                if (this.manager && this.manager._rotateGeminiKey()) {
                    this.genAI = new GoogleGenerativeAI(this.manager._getGeminiKey());
                    this.chat = null;
                    return this.execute(input, retryCount + 1);
                }
            }

            // 2. Handle Busy / Rate Limits / Server Errors (429/503/500)
            if (errorText.includes("429") || errorText.includes("503") || errorText.includes("500") || 
                errorText.includes("Internal error") || errorText.includes("Service Unavailable") || 
                errorText.includes("quota") || errorText.includes("limit")) {
                if (this.manager && this.manager._rotateGeminiKey()) {
                    this.genAI = new GoogleGenerativeAI(this.manager._getGeminiKey());
                    this.chat = null; 
                    console.log(`-> [Agent] Model busy or rate limited. Rotating to KEY #${(this.manager.currentGeminiKeyIndex % this.manager.geminiKeys.length) + 1}...`);
                    return this.execute(input, retryCount + 1);
                } 
                
                if (this._rotateModel()) {
                    console.log(`-> [Agent] Retrying with NEW MODEL: ${this._getCurrentModel()} (Attempt ${retryCount + 1})...`);
                    return this.execute(input, retryCount + 1);
                }
            } 
            
            // 3. Handle Bad Request (400) - Strict filter bypass
            if (errorText.includes("400") || errorText.includes("INVALID_ARGUMENT") || errorText.includes("BAD_REQUEST")) {
                console.warn(`-> [Agent] 400 Bad Request. Bypassing system filters...`);
                const injectedInput = `[SYSTEM INSTRUCTIONS]\n${this.config.instructions}\n\n[USER REQUEST]\n${input}`;
                
                const genAI = new GoogleGenerativeAI(this.manager._getGeminiKey());
                const cleanModel = genAI.getGenerativeModel({ model: this._getCurrentModel() });
                
                const result = await cleanModel.generateContent(injectedInput);
                const response = await result.response;
                const text = response.text();
                
                if (!text || text.trim().length === 0) {
                    console.warn("-> [Agent] Received empty response. Rotating to next key...");
                    if (this.manager && this.manager._rotateGeminiKey()) {
                        return this.execute(input, retryCount + 1);
                    }
                }
                
                return { text: text, usage: { promptTokens: 0, outputTokens: 0, totalTokens: 0 } };
            }

            throw error;
        }
    }

    _isTruncated(lastChunk, fullResponse) {
        const trimmed = lastChunk.trim();
        return trimmed.endsWith(',') || trimmed.endsWith('{') || trimmed.endsWith('[') || (trimmed.endsWith('"') && !trimmed.endsWith('"}'));
    }

    close() { console.log(`-> [Agent] ${this.config.name} persisted.`); }
}

module.exports = AgentManager;
