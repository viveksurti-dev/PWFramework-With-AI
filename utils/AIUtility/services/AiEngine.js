const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

const GEMINI_API_KEYS = [...new Set((process.env.GEMINI_API_KEY || "").split(",").map(k => k.trim()).filter(k => k))];
let currentGeminiKeyIndex = 0;

const OPENAI_API_KEY = (process.env.CHATGPT_API_KEY || process.env.OPENAI_API_KEY || "").trim();
const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || "").trim();
const GROK_API_KEY = (process.env.GROK_API_KEY || "").trim();

let _openai = null;
let _anthropic = null;
let _grok = null;

// Cache of uploaded file IDs: filePath → { fileId, uploadedAt }
// Files are reused within the same process run to avoid re-uploading on every page.
const _fileIdCache = new Map();

// ── AI Usage Logger ───────────────────────────────────────────────────────────
// Appends one line per AI call to logs/ai_usage.log
// Format: [AI Usage][2026-05-07 17:44:26 IST] gemma-4-26b-it | prompt: 12321 tokens | output: 2719 tokens | total: 15040 tokens
const AI_USAGE_LOG = path.join(__dirname, "..", "..", "..", "logs", "ai_usage.log");

function logAiUsage(model, promptTokens, outputTokens, totalTokens) {
  try {
    // Ensure logs/ directory exists
    const logDir = path.dirname(AI_USAGE_LOG);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    // Timestamp in IST (Ahmedabad / UTC+5:30)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // UTC+5:30 in ms
    const ist = new Date(now.getTime() + istOffset);
    const pad = (n) => String(n).padStart(2, "0");
    const dateStr = `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
    const timeStr = `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())}`;
    const tzAbbr = "IST";

    const prompt  = promptTokens  != null ? promptTokens  : "?";
    const output  = outputTokens  != null ? outputTokens  : "?";
    const total   = totalTokens   != null ? totalTokens   : (
      promptTokens != null && outputTokens != null ? promptTokens + outputTokens : "?"
    );

    const line = `[AI Usage][${dateStr} ${timeStr} ${tzAbbr}] ${model} | prompt: ${prompt} tokens | output: ${output} tokens | total: ${total} tokens\n`;

    // Prepend so newest entry is always at the top (descending order)
    const existing = fs.existsSync(AI_USAGE_LOG)
        ? fs.readFileSync(AI_USAGE_LOG, "utf8").trimStart()
        : "";
    fs.writeFileSync(AI_USAGE_LOG, line + existing, "utf8");
    console.log(`-> [AI Usage] ${model} | prompt: ${prompt} | output: ${output} | total: ${total} tokens`);
  } catch (e) {
    // Never let logging crash the main flow
    console.warn(`-> [AI Usage] Failed to write log: ${e.message}`);
  }
}

function getOpenAI() {
  if (!OPENAI_API_KEY) return null;
  if (!_openai) _openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  return _openai;
}

function getAnthropic() {
  if (!ANTHROPIC_API_KEY) return null;
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return _anthropic;
}

function getGrok() {
  if (!GROK_API_KEY) return null;
  if (!_grok) _grok = new OpenAI({ apiKey: GROK_API_KEY, baseURL: "https://api.xai.com/v1" });
  return _grok;
}

let lastRequestTime = 0;

/**
 * Returns the single ordered fallback model list.
 * The first available model is used; subsequent models are fallbacks on failure.
 *
 * @returns {Array<{provider: string, model: string}>}
 */
function getModelChain() {
  return [
    { provider: "gemini", model: "gemma-4-31b-it" },
    { provider: "gemini", model: "gemini-3.1-flash-lite" },
    { provider: "gemini", model: "gemini-2.5-flash" },
    { provider: "gemini", model: "gemini-2.5-flash-lite" },
    { provider: "gemini", model: "gemini-2.0-flash" }
  ];
}

/**
 * Preflight check: verifies at least one model in the chain is reachable.
 * @returns {Promise<{provider: string, model: string} | null>}
 */
async function preflight() {
  const chain = getModelChain();
  const keys = (process.env.GEMINI_API_KEY || "").split(",").map(k => k.trim()).filter(k => k);
  
  console.log("-> [Preflight] Verifying model availability across all keys...");

  for (const item of chain) {
    for (let i = 0; i < keys.length; i++) {
        try {
            if (item.provider === "gemini") {
                const { GoogleGenerativeAI } = require("@google/generative-ai");
                const genAI = new GoogleGenerativeAI(keys[i]);
                const model = genAI.getGenerativeModel({ model: item.model });
                
                await model.generateContent({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } });
                console.log(`   ✅ ${item.model} is available (using Key #${i + 1}).`);
                return item;
            }
        } catch (e) {
            // Keep trying other keys for this model
        }
    }
    console.warn(`   ⚠️ ${item.model} is not reachable with any of your ${keys.length} keys.`);
  }
  return null;
}

/**
 * Calls AI with automatic fallback through the model chain.
 *
 * @param {string}  prompt      - The prompt text
 * @param {string|null} base64Image - Optional base64 screenshot
 * @param {number}  maxRetries  - Retry attempts (default 3)
 * @returns {Promise<string>}
 */
async function callAI(prompt, base64Image = null, maxRetries = 3) {
  const fallbackModels = getModelChain();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    for (const ai of fallbackModels) {
      const keysToTry = ai.provider === "gemini" ? GEMINI_API_KEYS.length : 1;

      for (let keyTry = 0; keyTry < keysToTry; keyTry++) {
        try {
          if (ai.provider === "gemini") {
            const currentKey = GEMINI_API_KEYS[currentGeminiKeyIndex % GEMINI_API_KEYS.length];
            const genAI = new GoogleGenerativeAI(currentKey);
            const model = genAI.getGenerativeModel({ model: ai.model });
            
            const promptParts = [prompt];
            if (base64Image) {
              promptParts.push({ inlineData: { data: base64Image, mimeType: "image/png" } });
            }

            const result = await model.generateContent(promptParts);
            const text = result.response.text();
            
            const usage = result.response.usageMetadata || {};
            logAiUsage(ai.model, usage.promptTokenCount, usage.candidatesTokenCount, usage.totalTokenCount);
            return text;
          }
        } catch (error) {
          const errorText = error.message || "";
          const status = error.status || error.statusCode || 0;

          // 1. Handle Dead Keys (403)
          if (status === 403 || errorText.includes("denied") || errorText.includes("permission")) {
            console.error(`-> [AI] Key #${(currentGeminiKeyIndex % GEMINI_API_KEYS.length) + 1} is DEAD. Skipping...`);
            currentGeminiKeyIndex++;
            continue;
          }

          // 2. Handle Busy / Rate Limits / Server Errors (429/503/500)
          if (status === 429 || status === 503 || status === 500 || errorText.includes("Internal error") || errorText.includes("Service Unavailable") || errorText.includes("quota")) {
            console.log(`-> [AI] ${ai.model} busy or limited on key #${(currentGeminiKeyIndex % GEMINI_API_KEYS.length) + 1}. Rotating...`);
            currentGeminiKeyIndex++;
            continue;
          }

          // 3. Handle Bad Request (400) - Strict filter bypass
          if (status === 400 || errorText.includes("INVALID_ARGUMENT") || errorText.includes("MODEL_NOT_FOUND")) {
            console.warn(`-> [AI] 400 Bad Request/Not Found on ${ai.model}. Attempting Prompt Injection fallback...`);
            try {
              const currentKey = GEMINI_API_KEYS[currentGeminiKeyIndex % GEMINI_API_KEYS.length];
              const genAI = new GoogleGenerativeAI(currentKey);
              const model = genAI.getGenerativeModel({ model: ai.model });
              const result = await model.generateContent(prompt);
              return result.response.text();
            } catch (e) {
              // If injection also fails, move to next model/key
            }
          }

          console.warn(`-> [AI] ${ai.model} failed: ${status || errorText.substring(0, 50)}. Trying next...`);
          break; // Move to next model
        }
      }
    }
    if (attempt < maxRetries) {
      const waitSeconds = attempt * 30;
      console.log(`\n-> [AI] All models busy. Waiting ${waitSeconds}s before retry ${attempt}/${maxRetries - 1}...`);
      await new Promise(r => setTimeout(r, waitSeconds * 1000));
    }
  }
  throw new Error("Failed to generate content: All fallback models and retries exhausted.");
}

/**
 * Startup health check — sends a tiny prompt to each model in the chain.
 * Returns the first model that responds successfully.
 * Skips models that are unreachable, not found (404), or rate-limited (429).
 *
 * @returns {Promise<{provider: string, model: string}|null>} The first healthy model, or null if none work.
 */
async function preflight() {
  const models = getModelChain();
  const testPrompt = "Reply with OK";

  console.log("\n-> [Preflight] Checking AI model availability...\n");

  for (const ai of models) {
    try {
      if (ai.provider === "gemini") {
        if (GEMINI_API_KEYS.length === 0 || GEMINI_API_KEYS[0] === "api_key_here") {
          console.log(`   ⊘ ${ai.model} — skipped (no API key)`);
          continue;
        }
        const currentKey = GEMINI_API_KEYS[currentGeminiKeyIndex % GEMINI_API_KEYS.length];
        const genAI = new GoogleGenerativeAI(currentKey);
        const model = genAI.getGenerativeModel({ model: ai.model });
        await model.generateContent([testPrompt]);
        console.log(`   ✓ ${ai.model} — available`);
        return ai;

      } else if (ai.provider === "openai") {
        const openai = getOpenAI();
        if (!openai) {
          console.log(`   ⊘ ${ai.model} — skipped (no API key)`);
          continue;
        }
        await openai.chat.completions.create({
          model: ai.model,
          messages: [{ role: "user", content: testPrompt }],
          max_tokens: 5
        });
        console.log(`   ✓ ${ai.model} — available`);
        return ai;

      } else if (ai.provider === "anthropic") {
        const anthropic = getAnthropic();
        if (!anthropic) {
          console.log(`   ⊘ ${ai.model} — skipped (no API key)`);
          continue;
        }
        await anthropic.messages.create({
          model: ai.model,
          max_tokens: 5,
          messages: [{ role: "user", content: testPrompt }]
        });
        console.log(`   ✓ ${ai.model} — available`);
        return ai;

      } else if (ai.provider === "grok") {
        const grok = getGrok();
        if (!grok) {
          console.log(`   ⊘ ${ai.model} — skipped (no API key)`);
          continue;
        }
        await grok.chat.completions.create({
          model: ai.model,
          messages: [{ role: "user", content: testPrompt }],
          max_tokens: 5
        });
        console.log(`   ✓ ${ai.model} — available`);
        return ai;
      }

    } catch (error) {
      const status = error.status || error.statusCode || '';
      const msg = error.message || '';

      if (status === 404 || msg.includes("not found") || msg.includes("does not exist")) {
        console.log(`   ✗ ${ai.model} — model not found`);
      } else if (status === 429 || msg.includes("429") || msg.includes("quota") || msg.includes("Rate limit") || msg.includes("credit balance")) {
        console.log(`   ✗ ${ai.model} — rate limit / quota exceeded`);
        // For Gemini, try rotating key before giving up
        if (ai.provider === "gemini" && GEMINI_API_KEYS.length > 1) {
          currentGeminiKeyIndex++;
        }
      } else if (status === 401 || status === 403 || msg.includes("auth") || msg.includes("permission")) {
        console.log(`   ✗ ${ai.model} — authentication failed`);
      } else {
        console.log(`   ✗ ${ai.model} — ${msg.substring(0, 80)}`);
      }
    }
  }

  console.log("\n-> [Preflight] WARNING: No AI models are currently available!");
  return null;
}

/**
 * Calls AI with a DOM file attachment instead of inlining HTML as a string.
 *
 * Priority:
 *   1. Gemini File API  — uploads HTML, passes fileData URI (file NOT in prompt tokens)
 *   2. OpenAI Responses API — uploads HTML, passes file_id  (file NOT in prompt tokens)
 *   3. Fallback — reads file, cleans HTML, appends to prompt as text (old behaviour)
 *
 * Benefits over inline DOM:
 *   - Full untruncated HTML available to the model
 *   - Prompt token budget used only for instructions → more output tokens for scenarios
 *   - File is cached per process run — no re-upload on every page
 *
 * @param {string}      prompt       - Instruction prompt (no DOM string inside)
 * @param {string|null} htmlFilePath - Path to the saved .html DOM file
 * @param {string|null} base64Image  - Optional base64 screenshot
 * @returns {Promise<string>}
 */
async function callAIWithFile(prompt, htmlFilePath, base64Image = null) {
  const absPath = htmlFilePath ? path.resolve(htmlFilePath) : null;
  const fileExists = absPath && fs.existsSync(absPath);

  // ── Extract metadata and inject into prompt (ALL paths use this) ──────────
  // Metadata replaces raw DOM parsing — AI gets structured field info regardless
  // of whether the file attachment succeeds or falls back to inline text.
  let promptWithMetadata = prompt;
  if (fileExists) {
    try {
      const DomMetadataExtractor = require('../Scenario_Creation/DomMetadataExtractor');
      const rawHtml  = require('fs').readFileSync(absPath, 'utf8');
      const metadata = DomMetadataExtractor.extract(rawHtml);

      // Only inject if the prompt doesn't already have metadata (avoid duplication)
      if (!prompt.includes('PAGE METADATA') && !prompt.includes('STRUCTURED PAGE METADATA')) {
        const metaSummary = `
PAGE METADATA (pre-extracted — use as source of truth, do not re-parse the HTML):
- Title: ${metadata.pageInfo?.pageTitle || 'Unknown'}
- Module: ${metadata.pageInfo?.moduleName || 'Unknown'}
- Headings: ${(metadata.pageInfo?.headings || []).join(' | ')}
- Inputs (${metadata.inputs.length}): ${metadata.inputs.slice(0, 20).map(i => `${i.label || i.name}(${i.type}${i.required ? ',req' : ''})`).join(', ')}
- Dropdowns (${metadata.dropdowns.length}): ${metadata.dropdowns.map(d => d.fieldName).join(', ')}
- Radio groups (${metadata.radioGroups.length}): ${metadata.radioGroups.map(g => `${g.fieldName}[${g.options.join('/')}]`).join(', ')}
- Validations (${metadata.validations.length}): ${[...new Set(metadata.validations.map(v => `${v.field}:${v.rule}`))].slice(0, 12).join(', ')}
- Dependencies (${metadata.dependencies.length}): ${metadata.dependencies.map(d => `${d.trigger}→${d.controlledSection}(when:${d.triggerValue})`).join(', ')}
- Buttons: ${metadata.buttons.map(b => b.text).join(', ')}
`;
        promptWithMetadata = prompt + metaSummary;
        console.log(`-> [AI] Metadata injected into prompt (${metadata.inputs.length} inputs, ${metadata.dropdowns.length} dropdowns, ${metadata.dependencies.length} deps)`);
      }
    } catch (e) {
      // Metadata extraction failed — continue with original prompt
      console.warn(`-> [AI] Metadata injection skipped: ${e.message}`);
    }
  }

  // ── 1. Gemini File API ────────────────────────────────────────────────────
  if (fileExists && GEMINI_API_KEYS.length > 0 && GEMINI_API_KEYS[0] !== "api_key_here") {
    // Try each Gemini key before giving up on Gemini File API
    const startKeyIndex = currentGeminiKeyIndex;
    let geminiFileSuccess = false;

    for (let keyAttempt = 0; keyAttempt < GEMINI_API_KEYS.length; keyAttempt++) {
      const currentKey = GEMINI_API_KEYS[currentGeminiKeyIndex % GEMINI_API_KEYS.length];
    try {
      // Upload or reuse cached Gemini file URI — cache is PER KEY so key rotation works correctly
      let geminiFileUri = null;
      let geminiMimeType = "text/html";
      const keyIndex = currentGeminiKeyIndex % GEMINI_API_KEYS.length;
      const cacheKey = `gemini:key${keyIndex}:${absPath}`;  // per-key cache

      if (_fileIdCache.has(cacheKey)) {
        const cached = _fileIdCache.get(cacheKey);
        geminiFileUri  = cached.fileUri;
        geminiMimeType = cached.mimeType;
        console.log(`-> [AI] Gemini: reusing cached file URI for ${path.basename(absPath)} (key #${keyIndex + 1})`);
      } else {
        console.log(`-> [AI] Gemini: uploading DOM file ${path.basename(absPath)} (key #${(currentGeminiKeyIndex % GEMINI_API_KEYS.length) + 1})...`);
        const fileManager = new GoogleAIFileManager(currentKey);
        const uploadResult = await fileManager.uploadFile(absPath, {
          mimeType: "text/html",
          displayName: path.basename(absPath),
        });
        geminiFileUri  = uploadResult.file.uri;
        geminiMimeType = uploadResult.file.mimeType || "text/html";
        _fileIdCache.set(cacheKey, { fileUri: geminiFileUri, mimeType: geminiMimeType });
        console.log(`-> [AI] Gemini: file uploaded → ${geminiFileUri}`);
      }

      // For file-based calls, always use a capable model — not the lite/preview one.
      // gemini-2.5-flash has 1M context + 65K output, handles large DOM + 50+ scenarios.
      const FILE_CAPABLE_MODELS = ["gemini-2.5-flash", "gemini-3-flash-preview", "gemini-2.5-flash-lite", "gemini-3.1-flash-lite-preview"];
      const geminiModel = FILE_CAPABLE_MODELS.find(m =>
        getModelChain().some(c => c.provider === "gemini" && c.model === m)
      ) || "gemini-2.5-flash";

      const genAI = new GoogleGenerativeAI(currentKey);
      const model = genAI.getGenerativeModel({ model: geminiModel });

      // Build parts: instruction text + file reference + optional screenshot
      const parts = [
        { text: promptWithMetadata },
        { fileData: { mimeType: geminiMimeType, fileUri: geminiFileUri } },
      ];
      if (base64Image) {
        parts.push({ inlineData: { data: base64Image, mimeType: "image/png" } });
      }

      console.log(`-> [AI] Gemini: calling ${geminiModel} with file attachment (DOM not in prompt tokens)...`);
      const result = await model.generateContent({
        contents: [{ role: "user", parts }],
        // 131072 output tokens ≈ 100+ well-formed JSON scenario objects
        // temperature: 0.2 for more deterministic, focused scenario generation
        generationConfig: { 
          maxOutputTokens: 131072,
          temperature: 0.2
        },
      });

      const text = result.response.text();
      if (text) {
        const usage = result.response.usageMetadata || {};
        logAiUsage(`${geminiModel}`, usage.promptTokenCount, usage.candidatesTokenCount, usage.totalTokenCount);
        console.log(`-> [AI] Gemini file-based response received (${text.length} chars)`);
        geminiFileSuccess = true;
        return text;
      }

    } catch (err) {
        const isRateLimit =
          err.status === 429 ||
          (err.message && (
            err.message.includes("429") ||
            err.message.includes("quota") ||
            err.message.includes("Rate limit") ||
            err.message.includes("RESOURCE_EXHAUSTED")
          ));

        const isNetworkError =
          err.message && (
            err.message.includes("Error fetching from") ||
            err.message.includes("fetch failed") ||
            err.message.includes("ECONNREFUSED") ||
            err.message.includes("ENOTFOUND") ||
            err.message.includes("network") ||
            err.message.includes("socket")
          );

        const httpStatus  = err.status || err.statusCode || 'N/A';
        const errorType   = isRateLimit ? "RATE_LIMIT/QUOTA" : isNetworkError ? "NETWORK_ERROR" : "UNKNOWN";
        const keyNum      = (currentGeminiKeyIndex % GEMINI_API_KEYS.length) + 1;
        const hasNextKey  = GEMINI_API_KEYS.length > 1 && keyAttempt < GEMINI_API_KEYS.length - 1;

        console.log(`-> [AI Diagnostics] Model: gemini-file-api | HTTP Status: ${httpStatus} | Error Type: ${errorType} | Key: #${keyNum}/${GEMINI_API_KEYS.length} | Cooldown Applied: ${hasNextKey ? '3s' : 'N/A'} | Fallback Triggered: ${hasNextKey ? `retry with key #${keyNum + 1}` : 'OpenAI file upload'}`);

        if ((isRateLimit || isNetworkError) && hasNextKey) {
          currentGeminiKeyIndex++;
          // Delete only the current key's cache entry — not other keys' entries
          const oldKeyIndex = (currentGeminiKeyIndex - 1) % GEMINI_API_KEYS.length;
          _fileIdCache.delete(`gemini:key${oldKeyIndex}:${absPath}`);
          const reason = isRateLimit ? "quota exceeded" : "network error";
          console.log(`-> [AI] Gemini ${reason} on key #${((currentGeminiKeyIndex - 1) % GEMINI_API_KEYS.length) + 1}. Switching to key #${(currentGeminiKeyIndex % GEMINI_API_KEYS.length) + 1}...`);
          await new Promise(r => setTimeout(r, 3000));
          continue; // try next key
        }

        console.log(`-> [AI] Gemini file upload failed: ${err.message.substring(0, 120)}`);
        break; // non-rate-limit error or all keys exhausted — stop trying Gemini keys
      }
    } // end key rotation loop

    if (!geminiFileSuccess) {
      console.log(`-> [AI] All Gemini keys exhausted for file API. Trying OpenAI file upload...`);
    }
  }

  // ── 2. OpenAI Responses API ───────────────────────────────────────────────
  const openai = getOpenAI();
  if (openai && fileExists) {
    try {
      let fileId = null;
      const cacheKey = `openai:${absPath}`;

      if (_fileIdCache.has(cacheKey)) {
        fileId = _fileIdCache.get(cacheKey).fileId;
        console.log(`-> [AI] OpenAI: reusing cached file_id for ${path.basename(absPath)}`);
      } else {
        console.log(`-> [AI] OpenAI: uploading DOM file ${path.basename(absPath)}...`);
        const uploadedFile = await openai.files.create({
          file: fs.createReadStream(absPath),
          purpose: "assistants",
        });
        fileId = uploadedFile.id;
        _fileIdCache.set(cacheKey, { fileId });
        console.log(`-> [AI] OpenAI: file uploaded → ${fileId}`);
      }

      const content = [
        { type: "text", text: promptWithMetadata },
        { type: "input_file", file_id: fileId },
      ];
      if (base64Image) {
        content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } });
      }

      console.log(`-> [AI] OpenAI: calling gpt-4o with file attachment...`);
      const response = await openai.responses.create({
        model: "gpt-4o",
        input: [{ role: "user", content }],
        max_output_tokens: 32000,
      });

      const outputText = response.output
        .filter(b => b.type === "message")
        .flatMap(b => b.content)
        .filter(c => c.type === "output_text")
        .map(c => c.text)
        .join("");

      if (outputText) {
        const u = response.usage || {};
        logAiUsage("gpt-4o (file)", u.input_tokens, u.output_tokens, u.total_tokens);
        console.log(`-> [AI] OpenAI file-based response received (${outputText.length} chars)`);
        return outputText;
      }

    } catch (err) {
      console.log(`-> [AI] OpenAI file upload failed: ${err.message.substring(0, 120)}`);
      console.log(`-> [AI] Falling back to inline DOM...`);
    }
  }

  // ── 3. Fallback — metadata only, no raw DOM ──────────────────────────────
  // promptWithMetadata already contains the extracted metadata from the DOM.
  // No need to send raw HTML — metadata has all the field/validation/dependency info.
  if (fileExists) {
    console.log(`-> [AI] Fallback: using metadata-only prompt (no raw DOM)`);
    return callAI(promptWithMetadata, base64Image);
  }

  // No file at all — use original prompt
  return callAI(prompt, base64Image);
}

/**
 * Backward-compatible wrapper — existing callers use callAIWithFallback(prompt, image).
 */
async function callAIWithFallback(prompt, base64Image = null, maxRetries = 3) {
  return callAI(prompt, base64Image, maxRetries);
}

module.exports = {
  callAI,
  callAIWithFile,
  callAIWithFallback,
  preflight,
};
