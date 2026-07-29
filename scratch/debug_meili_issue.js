import fetch from 'node-fetch';

async function testMeili() {
  const res = await fetch('https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-formal-dresses&country=IN&cb=' + Date.now());
  const data = await res.json();
  console.log("API response debug:", data.debug);
  console.log("API products length:", data.products.length);
}

testMeili();
