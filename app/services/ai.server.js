import { GoogleGenerativeAI } from "@google/generative-ai";

let genAI = null;
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

/**
 * Extracts eCommerce filters from a natural language search query using OpenAI.
 * Gracefully falls back to returning the original query if OpenAI fails or is unconfigured.
 */
export async function extractFiltersFromQuery(userQuery) {
  if (!userQuery || userQuery.trim() === "") {
    return { clean_query: userQuery };
  }

  // If no API key is provided, gracefully fallback to normal search
  if (!genAI) {
    return { clean_query: userQuery };
  }

  try {
    const prompt = `You are a smart eCommerce search assistant. Users will type search queries in natural language, conversational sentences, or even mixed languages (like Hinglish). 
    
Your job is to understand their intent and extract any explicit filters.
User Query: "${userQuery}"

Return ONLY a valid JSON object with the following structure:
{
  "clean_query": "The core product or intent translated to a clean search phrase in English (e.g., 'dog wedding dress')",
  "min_price": (number or null),
  "max_price": (number or null),
  "attributes": {
     // Dynamically extract ANY other attributes mentioned (like size, color, material, occasion, gender). 
     // Return as key-value pairs. e.g., "size": "xl", "color": "red". Empty object {} if none.
  }
}

Examples: 
- "blue beach dress under 500" -> {"clean_query": "beach dress", "min_price": null, "max_price": 500, "attributes": {"color": "blue"}}
- "mere dog ke leye dress chahiye weding ya occesion jiska size x hai aur under 200" -> {"clean_query": "dog wedding dress", "min_price": null, "max_price": 200, "attributes": {"size": "x", "occasion": "wedding"}}
`;

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      }
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const parsed = JSON.parse(responseText);
    
    console.log("CFP: Gemini Extracted JSON:", parsed); 
    return parsed;
  } catch (error) {
    console.error("CFP: Gemini NLP Extraction Failed:", error.message); 
    // Graceful Fallback
    return { clean_query: userQuery };
  }
}
