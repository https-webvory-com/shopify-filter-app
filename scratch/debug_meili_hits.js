import fetch from 'node-fetch';

async function testMeiliHits() {
  // Let me call Meilisearch directly using HTTP request if port 7700 is accessible
  // Or let me test searching with different filters
  const res = await fetch('https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-formal-dresses&country=IN&debugMode=true&cb=' + Date.now());
  const data = await res.json();
  console.log("Full debug data:", data.debug);
  console.log("Products returned:", data.products.map(p => p.id));
}

testMeiliHits();
