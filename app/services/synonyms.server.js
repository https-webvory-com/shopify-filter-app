import prisma from "../db.server";
import meiliClient from "./meiliClient.server";

/**
 * Fetch all synonyms for a shop and sync them to Meilisearch.
 */
export async function syncSynonymsToMeilisearch(shop) {
  try {
    const activeSynonyms = await prisma.synonym.findMany({
      where: { shop, isActive: true },
    });

    const synonymDict = {};
    
    // Meilisearch expects: { "gown": ["dress"], "dress": ["gown"] }
    // If we want bidirectional, we add both ways. For now, let's just make it bidirectional for all words in the synonym list.
    for (const entry of activeSynonyms) {
      const targetWord = entry.word.trim().toLowerCase();
      const rawSynonyms = entry.synonyms.split(",").map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
      
      // Target word gets these synonyms
      if (!synonymDict[targetWord]) synonymDict[targetWord] = [];
      synonymDict[targetWord].push(...rawSynonyms);

      // And those synonyms also get the target word (Bidirectional)
      for (const s of rawSynonyms) {
        if (!synonymDict[s]) synonymDict[s] = [];
        synonymDict[s].push(targetWord);
      }
    }

    // Deduplicate lists
    for (const key in synonymDict) {
      synonymDict[key] = Array.from(new Set(synonymDict[key]));
    }

    console.log(`Syncing Synonyms for ${shop}:`, synonymDict);
    
    // Update Meilisearch
    await meiliClient.index("products").updateSynonyms(synonymDict);
    return true;
  } catch (error) {
    console.error("Error syncing synonyms to Meilisearch:", error);
    return false;
  }
}
