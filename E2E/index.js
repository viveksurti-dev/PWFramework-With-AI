const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const view = require("./src/views/view");

if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "your_api_key_here") {
  console.error("\n ERROR: Please add your GEMINI_API_KEY to the .env file.");
  process.exit(1);
} else {
  console.log("\n==============================================");
  console.log("   ✨ Special Thank You to Vivek Surati! ✨  ");
  console.log("\n==============================================");
  view.runCliMenu();
}
