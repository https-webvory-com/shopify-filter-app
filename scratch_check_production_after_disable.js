import https from "https";

const url = "https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=red-formal-dresses&country=IN&debug=1";

https.get(url, { rejectUnauthorized: false }, (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    try {
      const json = JSON.parse(data);
      console.log("=== API PRODUCTS ORDER (TOP 15) ===");
      if (json.products) {
        json.products.slice(0, 15).forEach((p, idx) => {
          console.log(`Position ${idx + 1}: ID ${p.id} | ${p.title} | selectedVariant: ${p.selectedVariantId}`);
        });
      }
      if (json.debug) {
        console.log("\nActive Rule Name:", json.debug.activeRuleName);
        console.log("Active Rule Conditions:", json.debug.activeRuleConditions);
      }
    } catch (e) {
      console.error(e);
    }
  });
});
