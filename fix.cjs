const fs = require('fs');
let f = 'extensions/theme-extension/assets/collectionFilterPro.js';
let txt = fs.readFileSync(f, 'utf8');
txt = txt.split('placeholder="Search ${setting.label}..."').join('placeholder="Filter options"');
fs.writeFileSync(f, txt);
