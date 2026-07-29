import fetch from 'node-fetch';

async function test() {
  // Let's test calling api/filter with sortBy=title-ascending
  const res1 = await fetch('https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-tie-dresses&country=IN&sortBy=title-ascending&cb=' + Date.now());
  const data1 = await res1.json();
  console.log("With sortBy=title-ascending -> Products count:", data1.products.length);

  // Let's test calling api/filter with default sortBy (best-selling)
  const res2 = await fetch('https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-tie-dresses&country=IN&sortBy=best-selling&cb=' + Date.now());
  const data2 = await res2.json();
  console.log("With sortBy=best-selling -> Products count:", data2.products.length);
}

test();
