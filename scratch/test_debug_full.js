import fetch from 'node-fetch';

async function test() {
  const url = `https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-formal-dresses&country=IN&debugFull=${Date.now()}`;
  const res = await fetch(url);
  const data = await res.json();

  console.log("Full Response Debug:");
  console.log(JSON.stringify(data.debug, null, 2));
}

test();
