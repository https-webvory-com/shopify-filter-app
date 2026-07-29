import fetch from 'node-fetch';

async function main() {
  const url = `https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-formal-dresses&country=IN&checkCode=${Date.now()}`;
  const res = await fetch(url);
  const data = await res.json();
  
  console.log("Returned Products Count:", data.products.length);
  console.log("Returned Total Count:", data.totalCount);
  console.log("Returned Debug Object:", data.debug);
}

main();
