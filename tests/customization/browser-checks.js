window.runCustomizationChecks = async () => {
  const results = [], frame = document.createElement('iframe'); frame.style.cssText = 'width:1100px;height:900px;border:0'; document.body.append(frame);
  const delay = ms => new Promise(r => setTimeout(r, ms)), doc = () => frame.contentDocument, win = () => frame.contentWindow;
  const assert = (value, message) => { if (!value) throw Error(message); };
  const wait = async fn => { await delay(50); for (let i = 0; i < 160; i++) { if (fn()) return; await delay(50); } throw Error('Browser condition timed out'); };
  const navigate = async path => { await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Frame load timeout')), 10000); frame.onload = () => { clearTimeout(timer); resolve(); }; frame.src = path; }); await delay(100); };
  const test = async (name, fn) => { try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); } catch (error) { results.push({ name, passed: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message); } };
  const read = async themeId => (await (await fetch('/admin?themeId=' + themeId)).json()).customization;
  const defaults = { enabled: false, css: '', javascript: '', javascriptEnabled: false, swatches: [] };
  const post = async (themeId, value, intent = 'save') => (await fetch('/admin', { method: 'POST', body: new URLSearchParams({ themeId, intent, customization: JSON.stringify(value) }) })).json();
  const control = values => fetch('/__control', { method: 'POST', body: JSON.stringify(values) });
  const fill = (selector, value) => { const e = doc().querySelector(selector); Object.getOwnPropertyDescriptor(e.tagName === 'TEXTAREA' ? win().HTMLTextAreaElement.prototype : win().HTMLInputElement.prototype, 'value').set.call(e, value); e.dispatchEvent(new (win().Event)('input', { bubbles: true })); e.dispatchEvent(new (win().Event)('change', { bubbles: true })); };
  const clickText = text => { const b = [...doc().querySelectorAll('button')].find(x => x.textContent.trim() === text); assert(b && !b.disabled, 'Button unavailable: ' + text); b.click(); };
  const css = '.cfp-filter-title { color: rgb(18, 52, 86); } .cfp-search-modal { border-radius: 17px; }';
  const javascript = "window.customizationRuns = (window.customizationRuns || 0) + 1; document.addEventListener('cfp:customization-ready', () => { window.customReadyRuns = (window.customReadyRuns || 0) + 1; }); document.addEventListener('cfp:search-products-rendered', () => { window.renderHookRuns = (window.renderHookRuns || 0) + 1; });";
  const config = { ...defaults, enabled: true, css, javascript, javascriptEnabled: true, swatches: [{ color: 'Navy Blue', hex: '#123456' }] };
  try {
    await test('actual editor saves theme CSS/JS and survives reload with per-theme isolation', async () => {
      await navigate('/app/settings/customization?themeId=1'); await wait(() => doc().querySelector('[name=enabled]'));
      doc().querySelector('[name=enabled]').click(); fill('[name=css]', css); clickText('JavaScript'); await wait(() => doc().querySelector('[name=javascriptEnabled]'));
      doc().querySelector('[name=javascriptEnabled]').click(); fill('[name=javascript]', javascript); await delay(50); clickText('Save customization');
      await wait(() => [...doc().querySelectorAll('[role=status]')].some(e => e.textContent.includes('saved')));
      const saved = await read('1'); assert(saved.enabled && saved.css === css && saved.javascript === javascript, 'Editor did not persist code');
      assert(await read('2') === null, 'Other theme changed');
      await navigate('/app/settings/customization?themeId=1'); await wait(() => doc().querySelector('[name=css]'));
      assert(doc().querySelector('[name=css]').value === css, 'Code lost after reload');
    });
    await test('filter swatches add, reject duplicates, update and remove through the editor', async () => {
      clickText('Filter swatches'); await wait(() => doc().querySelector('input[maxlength="100"]')); fill('input[maxlength="100"]', '  Navy   Blue  '); await delay(50); clickText('Add swatch'); await delay(50); clickText('Save customization');
      await wait(() => doc().querySelector('button[aria-label="Remove Navy Blue"]'));
      await wait(() => !doc().querySelector('fieldset').disabled);
      assert((await read('1')).swatches[0].color === 'Navy Blue', 'Swatch not normalized/persisted');
      fill('input[maxlength="100"]', 'navy blue'); await delay(50); clickText('Add swatch'); await delay(50);
      assert(doc().querySelector('[role=alert]').textContent.includes('already'), 'Duplicate not rejected');
      const colorInput = doc().querySelector('[aria-label="Color for Navy Blue"]');
      fill('[aria-label="Color for Navy Blue"]', '#123456'); await delay(50); clickText('Save customization'); await wait(() => !doc().querySelector('fieldset').disabled);
      assert((await read('1')).swatches[0].hex === '#123456', 'Swatch edit lost');
      doc().querySelector('button[aria-label="Remove Navy Blue"]').click(); await delay(50); clickText('Save customization'); await wait(() => !doc().querySelector('fieldset').disabled);
      assert((await read('1')).swatches.length === 0, 'Swatch removal lost'); await post('1', config);
    });
    await test('actual storefront asset applies CSS and initial/dynamic swatches without changing products', async () => {
      await navigate('/store?themeId=1'); await win().cfpCustomizationReady;
      assert(win().getComputedStyle(doc().querySelector('.cfp-filter-title')).color === 'rgb(18, 52, 86)', 'CSS did not apply');
      assert(win().getComputedStyle(doc().querySelector('.cfp-search-modal')).borderRadius === '17px', 'Instant style missing');
      assert(win().getComputedStyle(doc().querySelector('.cfp-swatch-circle')).backgroundColor === 'rgb(18, 52, 86)', 'Filter override missing');
      win().addSwatch(); await delay(50);
      assert([...doc().querySelectorAll('.cfp-swatch-circle')].every(e => win().getComputedStyle(e).backgroundColor === 'rgb(18, 52, 86)'), 'Late swatch not updated');
      assert([...doc().querySelectorAll('.cfp-product-card')].map(e => e.dataset.id).join(',') === '1,2', 'Product order changed');
    });
    await test('duplicate app bootstraps share one lookup and execute JavaScript/ready hooks once', async () => {
      await wait(() => win().customReadyRuns === 1);
      assert(win().customizationRuns === 1, 'Duplicate script execution');
      const calls = win().performance.getEntriesByType('resource').filter(e => e.name.includes('/api/customization') && !e.name.includes('asset='));
      assert(calls.length === 1, 'Duplicate config lookup');
      doc().dispatchEvent(new (win().Event)('cfp:search-products-rendered')); assert(win().renderHookRuns === 1, 'Existing render hook unavailable');
    });
    await test('other themes and query bypass do not apply or execute customization', async () => {
      for (const path of ['/store?themeId=2', '/store?themeId=1&cfp_disable_customization=1']) {
        await navigate(path); await win().cfpCustomizationReady;
        assert(!doc().querySelector('#cfp-theme-custom-css') && !doc().querySelector('#cfp-theme-custom-js') && !win().customizationRuns, 'Wrong theme/bypass applied code');
        assert(doc().querySelectorAll('.cfp-product-card').length === 2, 'Products unavailable');
      }
    });
    await test('disabled JavaScript and disabled customization retain saved code without executing it', async () => {
      await post('1', { ...config, javascriptEnabled: false }); await navigate('/store?themeId=1'); await win().cfpCustomizationReady;
      assert(doc().querySelector('#cfp-theme-custom-css') && !doc().querySelector('#cfp-theme-custom-js') && !win().customizationRuns, 'Disabled JS executed or CSS lost');
      await post('1', { ...config, enabled: false }); await navigate('/store?themeId=1'); await win().cfpCustomizationReady;
      assert(!doc().querySelector('#cfp-theme-custom-css') && !win().customizationRuns, 'Disabled customization applied');
      assert((await read('1')).javascript === javascript, 'Disabling deleted code');
    });
    await test('invalid JavaScript edits preserve last-good database record and runtime errors are contained', async () => {
      await post('1', config); const bad = await post('1', { ...config, javascript: 'function (' }); assert(bad.error, 'Syntax error saved');
      assert((await read('1')).javascript === javascript, 'Last-good code lost');
      await post('1', { ...config, javascript: "throw Error('fixture merchant error');" }); await navigate('/store?themeId=1'); await win().cfpCustomizationReady; await delay(100);
      assert(win().browserErrors.length === 0 && doc().querySelectorAll('.cfp-product-card').length === 2, 'Merchant error escaped');
    });
    await test('CSS containing markup stays text and cannot create HTML scripts', async () => {
      await post('1', { ...config, javascriptEnabled: false, css: '</style><script>window.cssInjected=true</script>' });
      await navigate('/store?themeId=1'); await win().cfpCustomizationReady; assert(!win().cssInjected, 'CSS created script');
    });
    await test('API failure and timeout never delay products or apply a late response', async () => {
      await post('1', config);
      for (const flag of ['fail', 'slow']) {
        await control({ [flag]: true }); await navigate('/store?themeId=1');
        assert(doc().querySelectorAll('.cfp-product-card').length === 2, 'Products blocked by config');
        await win().cfpCustomizationReady; await delay(800);
        assert(!doc().querySelector('#cfp-theme-custom-css') && !win().customizationRuns, 'Failed/late response applied');
        await control({ [flag]: false });
      }
    });
    await test('unsaved theme switching can be cancelled; accepted switch loads separate saved values', async () => {
      await navigate('/app/settings/customization?themeId=1'); await wait(() => doc().querySelector('[name=css]')); fill('[name=css]', 'unsaved');
      win().confirm = () => false; const select = doc().querySelector('select'); select.value = '2'; select.dispatchEvent(new (win().Event)('change', { bubbles: true }));
      await delay(100); assert(doc().querySelector('[name=css]').value === 'unsaved', 'Cancelled switch discarded draft');
      win().confirm = () => true; select.value = '2'; select.dispatchEvent(new (win().Event)('change', { bubbles: true }));
      await wait(() => doc().querySelector('select').value === '2' && doc().querySelector('[name=css]').value === '');
      assert((await read('1')).css === css, 'Unsaved values persisted to old theme');
    });
    await test('restore defaults affects only selected theme and narrow layout fits long labels', async () => {
      await post('2', { ...config, css: '.cfp-filter-title{color:green}' });
      frame.style.width = '375px'; await navigate('/app/settings/customization?themeId=1'); await wait(() => doc().querySelector('[name=css]'));
      clickText('Filter swatches'); await wait(() => doc().querySelector('input[maxlength="100"]')); fill('input[maxlength="100"]', 'x'.repeat(100)); await delay(50); clickText('Add swatch'); await delay(50);
      assert(doc().documentElement.scrollWidth <= 375, 'Editor overflows narrow frame');
      win().confirm = () => true; clickText('Restore defaults'); await wait(() => [...doc().querySelectorAll('[role=status]')].some(e => e.textContent.includes('restored')));
      assert(await read('1') === null && (await read('2')).css.includes('green'), 'Reset leaked across themes');
    });
  } finally { await control({ fail: false, slow: false }); await post('1', defaults, 'reset'); await post('2', defaults, 'reset'); frame.remove(); }
  return results;
};
