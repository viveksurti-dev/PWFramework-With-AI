const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");

const GEMINI_API_KEYS = (process.env.GEMINI_API_KEY || "").split(",").map(k => k.trim()).filter(k => k);
let currentGeminiKeyIndex = 0;

const OPENAI_API_KEY = (process.env.CHATGPT_API_KEY || process.env.OPENAI_API_KEY || "").trim();
const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || "").trim();
const GROK_API_KEY = (process.env.GROK_API_KEY || "").trim();


let _openai = null;
let _anthropic = null;
let _grok = null;

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

async function callAIWithFallback(prompt, base64Image = null, maxRetries = 3) {
  // --- MANDATORY 5s COOLING PERIOD ---
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < 5000) {
      const waitTime = 5000 - timeSinceLast;
      console.log(`-> [AI] Cooling down for ${Math.ceil(waitTime/1000)}s...`);
      await new Promise(r => setTimeout(r, waitTime));
  }
  lastRequestTime = Date.now();

  const fallbackModels = [
    // --- FASTEST - Optimized for Tokens ---
    { provider: "gemini", model: "gemini-1.5-flash" },
    { provider: "gemini", model: "gemini-2.0-flash" },
    { provider: "gemini", model: "gemini-2.5-flash" },
    { provider: "openai", model: "gpt-4o-mini" },
    { provider: "openai", model: "gpt-3.5-turbo" }, 
    // --- POWERFUL ---
    { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
    { provider: "openai", model: "gpt-4o" },
    { provider: "grok", model: "grok-2-vision-1212" },
  ];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    for (const ai of fallbackModels) {
      if (base64Image && ai.model === "gpt-3.5-turbo") continue;

      try {
        if (ai.provider === "gemini") {
          if (GEMINI_API_KEYS.length === 0 || GEMINI_API_KEYS[0] === "api_key_here") continue;

          const currentKey = GEMINI_API_KEYS[currentGeminiKeyIndex % GEMINI_API_KEYS.length];
          const genAI = new GoogleGenerativeAI(currentKey);
          const model = genAI.getGenerativeModel({ model: ai.model });
          let promptParts = [prompt];
          if (base64Image) {
            promptParts.push({
              inlineData: { data: base64Image, mimeType: "image/png" },
            });
          }
          const result = await model.generateContent(promptParts);
          return result.response.text();
          
        } else if (ai.provider === "openai") {
          const openai = getOpenAI();
          if (!openai) continue;

          let messages = [];
          if (base64Image) {
            messages = [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  {
                    type: "image_url",
                    image_url: { url: `data:image/png;base64,${base64Image}` },
                  },
                ],
              },
            ];
          } else {
            messages = [{ role: "user", content: prompt }];
          }
          const response = await openai.chat.completions.create({
            model: ai.model,
            messages: messages,
          });
          return response.choices[0].message.content;

        } else if (ai.provider === "anthropic") {
          const anthropic = getAnthropic();
          if (!anthropic) continue;
          
          let messages = [];
          if (base64Image) {
            messages = [
              {
                role: "user",
                content: [
                  { type: "image", source: { type: "base64", media_type: "image/png", data: base64Image } },
                  { type: "text", text: prompt }
                ]
              }
            ];
          } else {
            messages = [{ role: "user", content: prompt }];
          }

          const response = await anthropic.messages.create({
            model: ai.model,
            max_tokens: 4096,
            messages: messages
          });
          return response.content[0].text;

        } else if (ai.provider === "grok") {
          const grok = getGrok();
          if (!grok) continue;
          
          let messages = [];
          if (base64Image) {
            messages = [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  {
                    type: "image_url",
                    image_url: { url: `data:image/png;base64,${base64Image}` },
                  },
                ],
              },
            ];
          } else {
            messages = [{ role: "user", content: prompt }];
          }
          const response = await grok.chat.completions.create({
            model: ai.model,
            messages: messages,
          });
          return response.choices[0].message.content;
        }

      } catch (error) {
        const isRateLimit =
          error.status === 429 ||
          (error.message &&
            (error.message.includes("429") ||
              error.message.includes("quota") ||
              error.message.includes("Rate limit") ||
              error.message.includes("credit balance")));
              
        if (isRateLimit) {
          if (ai.provider === "gemini" && GEMINI_API_KEYS.length > 1) {
            currentGeminiKeyIndex++;
            console.log(`-> [AI Warning] Gemini quota/rate limit exceeded. Switched to next API Key (Key #${(currentGeminiKeyIndex % GEMINI_API_KEYS.length) + 1})...`);
          } else {
            console.log(`-> [AI Warning] ${ai.model} rate limit / quota exceeded. Trying next model...`);
          }
        } else {
          console.log(`-> [AI Error] ${ai.model} failed: ${error.message.substring(0, 100)}...`);
        }
      }
    }
    if (attempt < maxRetries) {
      console.log(`\n [AI Rate Limit] All fallback models failed. Waiting 20 seconds before retry ${attempt}/${maxRetries}...`);
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
  throw new Error("Failed to generate content: All fallback models and retries exhausted.");
}

module.exports = {
  callAIWithFallback,
};
