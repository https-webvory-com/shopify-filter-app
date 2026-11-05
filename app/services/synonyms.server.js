import prisma from "../db.server";
import { DEFAULT_SEARCH_SETTINGS } from "../utils/searchSettings.js";
import { scheduleSearchIndex, syncConfiguredSearchSynonyms } from "./searchIndex.server.js";

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

    // Synonyms are index-wide. The shared products index contains all shops,
    // so a merchant action must only update that merchant's private index.
    if (activeSynonyms.length) await prisma.searchSetting.upsert({
      where: { shop },
      create: { shop, config: DEFAULT_SEARCH_SETTINGS },
      update: {},
    });
    await syncConfiguredSearchSynonyms(shop,synonymDict);
    await scheduleSearchIndex(shop);
    return true;
  } catch (error) {
    console.error("Error syncing synonyms to Meilisearch:", error);
    return false;
  }
}
