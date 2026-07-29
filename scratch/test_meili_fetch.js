import fetch from 'node-fetch';

async function test() {
  const res = await fetch('https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-tie-dresses&country=IN&cb=' + Date.now());
  const data = await res.json();
  console.log("Products Returned Count:", data.products.length);
  console.log("Products Titles:", data.products.map(p => p.title));
}

test();
