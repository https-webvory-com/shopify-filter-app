import https from "https";

const url = "https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=red-formal-dresses&country=IN&debug=1";

https.get(url, { rejectUnauthorized: false }, (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    try {
      const json = JSON.parse(data);
      console.log("=== PRODUCTION RESPONSE DEBUG ===");
      console.log("Products count:", json.products ? json.products.length : 0);
      if (json.products) {
        console.log("\nTop 15 Products on Storefront:");
        json.products.slice(0, 15).forEach((p, idx) => {
          console.log(`${idx + 1}. ID: ${p.id} | Title: ${p.title} | selectedVariant: ${p.selectedVariantId}`);
        });
      }
      if (json.debug) {
        console.log("\nDebug Info:", JSON.stringify(json.debug, null, 2));
      }
    } catch (e) {
      console.error("Parse Error:", e.message);
    }
  });
}).on("error", (err) => console.error(err));
