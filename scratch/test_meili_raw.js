import fetch from 'node-fetch';

async function main() {
  // Call Meilisearch HTTP API directly on production port 7700 or test via backend proxy
  const meiliUrl = 'https://aisearchfilter.webvory.com:7700/multi-search'; // or search endpoint
  
  // Or let's test api/filter with different parameters to see if Redis cache is serving old data!
  const res = await fetch('https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-formal-dresses&country=IN&testNoCache=' + Date.now());
  const data = await res.json();
  
  console.log("Redis Cached:", data.debug?.redisCached);
  console.log("Products length:", data.products.length);
  console.log("Total count:", data.totalCount);
  console.log("Titles:", data.products.map(p => p.title));
}

main();
