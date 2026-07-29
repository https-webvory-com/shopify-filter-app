import fetch from 'node-fetch';

async function test() {
  // Call exact URL from user's screenshot (without cache busting)
  const staleUrl = 'https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-tie-dresses&country=IN';
  const staleRes = await fetch(staleUrl);
  const staleData = await staleRes.json();

  console.log("=== EXACT STALE URL FROM USER'S SCREENSHOT ===");
  console.log("redisCached:", staleData.debug?.redisCached);
  console.log("Products Count:", staleData.products.length);

  // Call fresh URL with cache-busting param
  const freshUrl = `https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-tie-dresses&country=IN&flushRedis=${Date.now()}`;
  const freshRes = await fetch(freshUrl);
  const freshData = await freshRes.json();

  console.log("\n=== FRESH UNCACHED REQUEST ===");
  console.log("redisCached:", freshData.debug?.redisCached);
  console.log("Products Count:", freshData.products.length);
  console.log("Total Count:", freshData.totalCount);
}

test();
