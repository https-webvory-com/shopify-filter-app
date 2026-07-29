import fetch from 'node-fetch';

async function test() {
  const url = 'https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-tie-dresses&country=IN&cb=' + Date.now();
  const res = await fetch(url);
  const data = await res.json();

  console.log("Debug object from API:");
  console.log(JSON.stringify(data.debug, null, 2));
}

test();
