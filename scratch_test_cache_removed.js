import https from "https";

const url = "https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=red-formal-dresses&country=IN";

https.get(url, (res) => {
  let data = "";
  res.on("data", (chunk) => { data += chunk; });
  res.on("end", () => {
    try {
      const json = JSON.parse(data);
      console.log("=== LIVE API RESPONSE (AFTER CACHE FLUSH) ===");
      console.log("Total Products Returned:", json.products?.length);
      console.log("Total Count:", json.totalCount);
      console.log("\nProducts List (Positions 1 to 25):");
      (json.products || []).forEach((p, idx) => {
        const colorOpt = (p.options || []).find(o => o.name === "Color");
        console.log(`${idx + 1}. [${p.id}] ${p.title}`);
        console.log(`   image: ${p.image}`);
        console.log(`   colors: ${JSON.stringify(colorOpt?.values || [])}`);
      });
      if (json.debug) {
        console.log("\nDebug Object:", JSON.stringify(json.debug, null, 2));
      }
    } catch (e) {
      console.error("Parse Error:", e.message);
    }
  });
}).on("error", (err) => {
  console.error("Fetch Error:", err.message);
});
