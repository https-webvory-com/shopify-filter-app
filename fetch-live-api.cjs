fetch('https://collection-filter-pro.myshopify.com/apps/fiter-staging/api/filter?shop=collection-filter-pro.myshopify.com&collectionHandle=all')
  .then(res => res.json())
  .then(data => {
    const fs = require('fs');
    fs.writeFileSync('api-response.json', JSON.stringify(data, null, 2));
    console.log('Saved to api-response.json');
  })
  .catch(err => console.error(err));
