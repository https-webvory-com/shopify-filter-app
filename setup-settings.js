const { MeiliSearch } = require('meilisearch');

const client = new MeiliSearch({
  host: 'http://127.0.0.1:7700',
  apiKey: 'masterKey', // Update if necessary
});

async function setupSettings() {
  const index = client.index('products');

  console.log('1. Setting up Typo Tolerance...');
  // By default, Meilisearch only allows typos for words with 5+ characters.
  // We're lowering it to 4 to catch short typos like 'nevy' -> 'navy'
  await index.updateTypoTolerance({
    enabled: true,
    minWordSizeForTypos: {
      oneTypo: 4,
      twoTypos: 8,
    },
    disableOnWords: [],
    disableOnAttributes: []
  });
  console.log('Typo Tolerance updated! (Allowing 1 typo for 4+ char words)');

  console.log('2. Setting up Synonyms...');
  // A few basic synonyms for testing
  const synonyms = {
    'gown': ['dress'],
    'dress': ['gown'],
    'tshirt': ['tee', 't-shirt', 'shirt'],
    'tee': ['tshirt', 't-shirt', 'shirt'],
    'navy': ['blue']
  };
  
  await index.updateSynonyms(synonyms);
  console.log('Synonyms updated!', synonyms);

  console.log('All settings applied successfully!');
}

setupSettings().catch(console.error);
