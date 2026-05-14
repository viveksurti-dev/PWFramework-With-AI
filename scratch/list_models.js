const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function listModels() {
    const key = (process.env.GEMINI_API_KEY || "").split(",")[0].trim();
    if (!key) {
        console.error("No API key found in .env");
        return;
    }

    try {
        const axios = require('axios');
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
        
        console.log("-> Fetching available models...");
        const response = await axios.get(url);
        const data = response.data;
        
        if (data.models) {
            console.log("\n--- AVAILABLE MODELS ---");
            data.models.forEach(m => {
                if (m.name.toLowerCase().includes('gemma')) {
                    console.log(`ID: ${m.name} | Display: ${m.displayName}`);
                }
            });
            console.log("-------------------------\n");
        } else {
            console.log("No models returned. Response:", JSON.stringify(data));
        }
    } catch (e) {
        console.error("Error listing models:", e.message);
    }
}

listModels();
