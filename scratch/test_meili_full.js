import fetch from 'node-fetch';

async function test() {
  const url = 'https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-formal-dresses&country=IN&cb=' + Date.now();
  const res = await fetch(url);
  const data = await res.json();

  console.log("Total Count:", data.totalCount);
  console.log("Products Length:", data.products.length);
  console.log("Products:", data.products.map(p => ({ id: p.id, title: p.title })));
}

test();
