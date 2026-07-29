const url = "https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=red-formal-dresses&country=US";

fetch(url)
  .then(r => r.json())
  .then(data => {
    if (!data.products) return;
    console.log(JSON.stringify(data.products[0], null, 2));
  })
  .catch(console.error);
