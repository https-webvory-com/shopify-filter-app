window.runSettingsChecks = async () => {
  const results = [], frame = document.createElement('iframe'); frame.style.cssText = 'width:1100px;height:850px;border:0'; document.body.append(frame);
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const wait = async fn => { for (let i = 0; i < 120; i++) { if (fn()) return; await delay(50); } throw Error('Browser condition timed out'); };
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const doc = () => frame.contentDocument, win = () => frame.contentWindow;
  const navigate = async path => { await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Page load timeout')), 10000); frame.onload = () => { clearTimeout(timer); resolve(); }; frame.src = path; }); await delay(100); };
  const test = async (name, fn) => { try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); } catch (error) { results.push({ name, passed: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message); } };
  const post = async values => { const result = await (await fetch('/admin', { method: 'POST', body: new URLSearchParams(values) })).json(); if (result.error) throw Error(result.error); return result; };
  const read = async () => (await (await fetch('/admin')).json()).settings;
  const save = async values => { const existing = await read(); return post({ intent: 'save', settings: JSON.stringify({ ...existing, ...values }) }); };
  const control = values => fetch('/__control', { method: 'POST', body: JSON.stringify(values) });
  const fill = async (name, value) => { const input = doc().querySelector(`[name="${name}"]`); const proto = input.tagName === 'TEXTAREA' ? win().HTMLTextAreaElement.prototype : win().HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value); input.dispatchEvent(new (win().Event)('input', { bubbles: true })); await delay(30); };
  const click = async text => { const button = [...doc().querySelectorAll('button')].find(b => b.textContent === text && !b.disabled); assert(button, 'Button missing: ' + text); button.click(); await delay(100); };
  const open = async () => { await wait(() => doc().querySelector('.cfp-search-modal')); doc().querySelector('input[name=q]').click(); await wait(() => doc().querySelector('.cfp-search-modal').classList.contains('cfp-open')); };
  const query = async text => { const input = doc().querySelector('#cfp-main-search-input'); input.value = text; input.dispatchEvent(new (win().Event)('input', { bubbles: true })); await delay(500); };
  const instantCards = () => doc().querySelectorAll('.cfp-product-card');
  const gridCards = () => doc().querySelectorAll('#cfp-products-container .cfp-product-card');
  try {
    await post({ intent: 'reset' });
    await test('actual editor saves settings and reloads persisted values', async () => {
      await navigate('/admin-ui'); await wait(() => doc().querySelector('[name=productLimit]'));
      await fill('productLimit', '3'); await fill('pageSize', '4'); await fill('manualSuggestions', 'Blue Dress\nRed Dress\n<script>'); await click('Save settings');
      await wait(() => doc().body.textContent.includes('Search settings saved.'));
      assert((await read()).productLimit === 3, 'Product count not saved');
      await navigate('/admin-ui'); await wait(() => doc().querySelector('[name=productLimit]'));
      assert(doc().querySelector('[name=productLimit]').value === '3', 'Reload lost saved count');
    });
    await test('manual suggestions show in order, escape markup, and honor blacklist', async () => {
      await control({ blacklist: [{ term: 'red dress', operator: 'exact' }] });
      await navigate('/'); await open(); await wait(() => doc().querySelector('#cfp-recent-searches-list').textContent.includes('Blue Dress'));
      const list = doc().querySelector('#cfp-recent-searches-list');
      assert(!list.textContent.includes('Red Dress'), 'Blacklisted manual term visible');
      assert(list.textContent.includes('<script>') && !list.querySelector('script'), 'Manual markup unsafe');
      assert(list.textContent.indexOf('Blue Dress') < list.textContent.indexOf('<script>'), 'Manual order changed');
    });
    await test('instant product count and typed suggestion/collection counts apply', async () => {
      await save({ suggestionLimit: 2, collectionLimit: 2 }); await navigate('/'); await open(); await query('blue');
      await wait(() => instantCards().length === 3);
      assert(doc().querySelectorAll('#cfp-recent-searches-list li').length === 2, 'Wrong suggestion count');
      assert(doc().querySelectorAll('#cfp-search-collections li').length === 3, 'Expected query link plus two collections');
    });
    await test('zero suggestion, collection and recent counts hide sections', async () => {
      await save({ suggestionLimit: 0, collectionLimit: 0, recentLimit: 0, manualSuggestions: [] });
      await navigate('/'); await open(); await query('blue'); await wait(() => instantCards().length === 3);
      assert(doc().querySelector('#cfp-recent-searches-container').style.display === 'none', 'Suggestion section visible');
      assert(doc().querySelector('#cfp-search-collections').children.length === 0, 'Collections visible');
      await query(''); await wait(() => doc().querySelector('#cfp-recent-searches-container').style.display === 'none');
    });
    await test('minimum character setting delays typed search and clearing restores manual terms', async () => {
      await save({ minChars: 4, manualSuggestions: ['Start here'] }); await navigate('/'); await open();
      await query('blu'); assert(!doc().querySelector('#cfp-search-body').classList.contains('cfp-has-results'), 'Searched before minimum');
      await query('blue'); await wait(() => instantCards().length === 3);
      await query(''); await wait(() => doc().querySelector('#cfp-recent-searches-list').textContent.includes('Start here'));
    });
    await test('disabling instant search preserves native input without creating modal', async () => {
      await save({ instantEnabled: false }); await navigate('/'); await delay(100);
      assert(!doc().querySelector('.cfp-search-modal'), 'Disabled modal initialized');
      assert(doc().querySelector('input[name=q]'), 'Native search lost');
    });
    await test('search results page size, vendor/labels and inline input settings apply', async () => {
      await save({ showSearchInput: false, showVendor: false, showSale: false, showSoldOut: false });
      await navigate('/search?q=blue&grid=1'); await wait(() => gridCards().length === 4);
      assert(doc().querySelector('.cfp-inline-search-form').hidden, 'Inline input not hidden');
      assert(!doc().querySelector('.cfp-product-card__vendor'), 'Vendor not hidden');
      assert(!doc().querySelector('.cfp-product-card__badge'), 'Labels not hidden');
      const more = doc().querySelector('#cfp-load-more-btn'); assert(more, 'Load more missing'); more.click();
      await wait(() => gridCards().length === 8);
      assert(new Set([...gridCards()].map(c => c.querySelector('a').href)).size === 8, 'Page boundary duplicated products');
    });
    await test('search display controls can be reenabled without changing results', async () => {
      await save({ showSearchInput: true, showVendor: true, showSale: true, showSoldOut: true });
      await navigate('/search?q=blue&grid=1'); await wait(() => gridCards().length === 4);
      assert(!doc().querySelector('.cfp-inline-search-form').hidden, 'Search input not restored');
      assert(doc().querySelector('.cfp-product-card__vendor'), 'Vendor not restored');
      const labels = [...doc().querySelectorAll('.cfp-product-card__badge')].map(e => e.textContent);
      assert(labels.includes('ON SALE') && labels.includes('Sold out'), 'Sale/sold-out labels not restored');
      await save({ showSearchInput: false, showVendor: false, showSale: false, showSoldOut: false });
    });
    await test('collection page retains page size, vendor, badges and input', async () => {
      await navigate('/collections/all?grid=1'); await wait(() => gridCards().length === 25);
      assert(!doc().querySelector('.cfp-inline-search-form').hidden, 'Search settings hid collection input');
      assert(doc().querySelector('.cfp-product-card__vendor'), 'Search settings hid collection vendor');
      assert(doc().querySelector('.cfp-product-card__badge'), 'Search settings hid collection badges');
    });
    await test('restoring defaults through actual editor removes saved overrides', async () => {
      await navigate('/admin-ui'); await wait(() => doc().querySelector('[name=productLimit]')); await click('Restore defaults');
      await wait(() => doc().body.textContent.includes('restored to defaults')); assert(await read() === null, 'Saved row not removed');
      await navigate('/'); await open(); await query('blue'); await wait(() => instantCards().length === 6);
    });
    await test('API failure and timeout keep default instant search functional', async () => {
      for (const values of [{ fail: true }, { fail: false, slow: true }]) {
        await control(values); await navigate('/'); await open(); await query('blue'); await wait(() => instantCards().length === 6);
      }
      await control({ slow: false, fail: false });
    });
    await test('narrow admin layout fits and no storefront JavaScript errors occurred', async () => {
      assert(win().browserErrors.length === 0, win().browserErrors.join('; '));
      frame.style.width = '375px'; await navigate('/admin-ui'); await wait(() => doc().querySelector('[name=pageSize]'));
      assert(doc().documentElement.scrollWidth <= 375, 'Admin overflows mobile frame');
    });
  } finally { await control({ fail: false, slow: false, blacklist: [] }); frame.remove(); }
  return results;
};

