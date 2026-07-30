import https from "https";

const url = "https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=red-formal-dresses&country=IN&debug=1&limit=250";

https.get(url, (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    try {
      const json = JSON.parse(data);
      console.log("Total products returned in items:", json.items ? json.items.length : 0);
      if (json.items) {
        json.items.forEach((p, idx) => {
          if (p.title.includes("CD0186") || p.id == 15136882327923 || idx < 10) {
            console.log(`Pos ${idx + 1}: ID ${p.id} | ${p.title} | selectedVariant: ${p.selectedVariantId}`);
          }
        });
        const pos = json.items.findIndex(p => String(p.id).includes("15136882327923") || p.title.includes("CD0186"));
        console.log(`\nCD0186 Exact Position in live API response: ${pos !== -1 ? pos + 1 : 'NOT FOUND IN FIRST 250'}`);
      }
      if (json.debug) {
        console.log("\nDebug Top Product Scores:", JSON.stringify(json.debug.topProductScores ? json.debug.topProductScores.slice(0, 15) : json.debug, null, 2));
      }
    } catch (e) {
      console.error("Parse Error:", e.message);
    }
  });
}).on("error", (err) => console.error(err));
