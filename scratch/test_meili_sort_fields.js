import fetch from 'node-fetch';

async function testSort(sortVal) {
  const url = `https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-tie-dresses&country=IN&sortBy=${sortVal}&cb=` + Date.now();
  const res = await fetch(url);
  const data = await res.json();
  console.log(`sortBy=${sortVal} -> products.length = ${data.products.length}`);
}

async function run() {
  await testSort("best-selling");
  await testSort("title-ascending");
  await testSort("price-ascending");
  await testSort("created-descending");
}

run();
