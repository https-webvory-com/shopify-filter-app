import fetch from 'node-fetch';

async function test() {
  // Pass random unique parameter so Redis key fullApiResponse:shop:... is completely new!
  const randomParam = Math.floor(Math.random() * 1000000);
  const url = `https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-formal-dresses&country=IN&nocache=${randomParam}`;
  
  const res = await fetch(url);
  const data = await res.json();

  console.log("Unique Param Request Output:");
  console.log("Total Count:", data.totalCount);
  console.log("Products Length:", data.products.length);
  console.log("Titles:", data.products.map(p => p.title));
}

test();
