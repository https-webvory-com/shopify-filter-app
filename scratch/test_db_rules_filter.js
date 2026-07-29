import fetch from 'node-fetch';

async function test() {
  const url = `https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-tie-dresses&country=IN&debugRules=${Date.now()}`;
  const res = await fetch(url);
  const data = await res.json();

  console.log("Response Debug Object:", data.debug);
}

test();
