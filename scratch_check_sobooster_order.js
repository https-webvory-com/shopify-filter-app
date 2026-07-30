import https from "https";

const url = "https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=red-formal-dresses&country=IN&limit=50";

https.get(url, { rejectUnauthorized: false }, (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    try {
      const json = JSON.parse(data);
      console.log("=== API PRODUCTS IN ORDER ===");
      json.products.forEach((p, idx) => {
        console.log(`Pos ${idx + 1}: ID ${p.id} | Title: ${p.title}`);
      });
    } catch (e) {
      console.error(e);
    }
  });
});
