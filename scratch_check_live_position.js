import https from "https";

const url = "https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=red-formal-dresses&country=IN&page=1&limit=25";

const req = https.get(url, { rejectUnauthorized: false }, (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    try {
      const json = JSON.parse(data);
      console.log("Total items on Page 1:", json.products ? json.products.length : 0);
      if (json.products) {
        json.products.forEach((p, idx) => {
          console.log(`Page 1 - Position ${idx + 1}: ID ${p.id} | ${p.title}`);
        });
      } else {
        console.log("Response keys:", Object.keys(json));
      }
    } catch (e) {
      console.error("Parse Error:", e.message, "Data snippet:", data.substring(0, 200));
    }
  });
});

req.on("error", (err) => console.error("HTTP Error:", err.message));
req.setTimeout(5000, () => {
  console.error("Timeout!");
  req.destroy();
});
