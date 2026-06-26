const http = require('http');

http.get('http://localhost:3000/api/filter?shop=collection-filter-pro.myshopify.com&collectionHandle=all', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('Settings:', json.settings.map(s => s.filterKey || s.type));
      console.log('Tags Facets:', json.facets.tags.filter(t => t.value.toLowerCase().includes('length')));
    } catch (e) {
      console.log('Error parsing JSON:', e.message);
    }
  });
}).on('error', (err) => {
  console.log('Error:', err.message);
});
