import https from "https";

const url = "https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=red-formal-dresses&country=IN&limit=25";

https.get(url, { rejectUnauthorized: false }, (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    try {
      const json = JSON.parse(data);
      console.log("=== LIVE PRODUCTION STOREFRONT PRODUCTS (1-25) ===");
      json.products.forEach((p, idx) => {
        console.log(`Position ${idx + 1}: ${p.title} (ID: ${p.id})`);
      });
    } catch (e) {
      console.error(e);
    }
  });
});
