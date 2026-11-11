window.runNativeQuickViewTests = async () => {
  const qv = cfpQuickViewInstance;
  const results = [];
  const native = document.querySelector('quick-add-modal');
  const trigger = document.querySelector('#native-trigger');
  const app = document.querySelector('#app-trigger');
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const tick = () => new Promise(resolve => setTimeout(resolve, 40));
  const mode = value => qv.configure({ ...window.cfpGlobalSettings, quickViewStyle: value });
  const reset = async () => {
    qv.closeModal(); mode('app'); fixture.requests = []; fixture.cartMode = 'success';
    Object.assign(nativeFixture, { fail: false, unsupported: false, delay: 0, ignoreAbort: false });
    await tick();
  };
  const test = async (name, body) => {
    try { await reset(); await body(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  };
  const withVariantButtons = async body => {
    const section = document.createElement('section');
    section.innerHTML = '<modal-opener data-modal="#QuickAdd-11"><button class="size-choice" data-product-url="/fr/products/multi?variant=12"><span style="font-weight:700">S</span></button></modal-opener>' +
      '<modal-opener data-modal="#QuickAdd-11" style="display:none"><button data-product-url="/fr/products/multi?variant=13"><span style="text-decoration:line-through;opacity:.5">M</span></button></modal-opener>';
    document.body.appendChild(section);
    try { await tick(); await body(section, [...section.querySelectorAll('button')]); }
    finally { qv.closeModal(); section.remove(); await tick(); }
  };
  await test('variant size choices retain labels and open the clicked variant once', () => withVariantButtons(async (section, buttons) => {
    mode('app'); mode('app'); await tick();
    assert(!section.querySelector('[data-cfp-theme-replacement]') && !buttons[0].hidden, 'size choices replaced');
    assert(buttons[0].textContent === 'S' && buttons[1].textContent === 'M', 'size labels changed');
    assert(buttons[1].firstElementChild.style.textDecoration === 'line-through' && getComputedStyle(buttons[1]).display === 'inline-block', 'sold-out presentation changed');
    assert(getComputedStyle(buttons[1].parentElement).display === 'none', 'hidden color shown');
    buttons[0].click(); await tick();
    assert(qv.selectedVariantId === 12 && qv.selectedOptions.join() === 'Blue,S', 'clicked variant not selected');
    assert(qv.modal.querySelector('.cfp-qv-view-details-link').href.endsWith('?variant=12'), 'details variant lost');
    assert(qv.carouselImages[0] === products.multi.variants[1].featured_image.src, 'clicked variant hero missing');
    assert(!native.hasAttribute('open') && fixture.requests.filter(r => r.url.endsWith('.js')).length === 1, 'competing native request');
  }));
  await test('variant URL changes restore size controls and reject unrelated variants', () => withVariantButtons(async (section, buttons) => {
    const button = buttons[0];
    button.setAttribute('data-product-url', '/fr/products/multi'); await tick();
    assert(button.hidden && section.querySelector('[data-cfp-theme-replacement]'), 'ordinary opener not adapted');
    button.setAttribute('data-product-url', '/fr/products/multi?variant=13'); await tick();
    assert(!button.hidden && !section.querySelector('[data-cfp-theme-replacement]'), 'variant opener not restored');
    button.click(); await tick();
    assert(qv.selectedVariantId === 13 && qv.modal.querySelector('.cfp-qv-add-to-cart-btn').disabled, 'sold-out variant not retained');
    qv.closeModal(); button.setAttribute('data-product-url', '/fr/products/multi?variant=999'); await tick();
    button.click(); await tick(); assert(qv.selectedVariantId === 11, 'unrelated ID selected');
    qv.closeModal(); button.setAttribute('data-product-url', 'https://example.invalid/products/multi?variant=12');
    assert(CfpQuickViewAdapters.getVariantId(button) === null, 'foreign product accepted');
    mode('theme'); await tick(); assert(!button.hidden && button.textContent === 'S', 'theme labels not restored');
  }));
  await test('variant size choices keep wholesale guest login gating', () => withVariantButtons(async (section, buttons) => {
    const settings = { ...window.cfpGlobalSettings }, loggedIn = window.cfpCustomerLoggedIn;
    try {
      window.cfpCustomerLoggedIn = false; qv.configure({ ...settings, isWholesale: true });
      buttons[0].click(); await tick();
      assert(qv.selectedVariantId === 12 && qv.modal.querySelector('.cfp-qv-login-btn'), 'variant bypassed login');
      assert(!qv.modal.querySelector('.cfp-qv-add-to-cart-btn') && !qv.modal.querySelector('.cfp-qv-price'), 'wholesale controls exposed');
      assert(!native.hasAttribute('open'), 'native bypass opened');
    } finally { window.cfpCustomerLoggedIn = loggedIn; qv.configure(settings); }
  }));
  await test('variant selection uses the clicked URL during delayed product loading', () => withVariantButtons(async (section, buttons) => {
    fixture.delay = 80;
    try {
      const loading = qv.openModal('multi', buttons[0]);
      buttons[0].setAttribute('data-product-url', '/fr/products/multi?variant=13');
      await loading;
      assert(qv.selectedVariantId === 12, 'later theme update changed clicked variant');
    } finally { fixture.delay = 0; }
  }));
  await test('App mode replaces native opener and opens only App Quick View', async () => {
    const replacement = document.querySelector('[data-cfp-theme-replacement]');
    assert(trigger.hidden && replacement, 'native opener not replaced');
    replacement.click(); await tick();
    assert(qv.overlay.classList.contains('cfp-active') && !native.hasAttribute('open'), 'competing dialogs');
    assert(fixture.requests.length === 1 && fixture.requests[0].url.endsWith('.js'), 'native loader also ran');
  });
  await test('Theme mode restores original buttons without changing direct cart controls', async () => {
    mode('theme'); await tick();
    assert(!trigger.hidden && !document.querySelector('[data-cfp-theme-replacement]'), 'native not restored');
    assert(!document.querySelector('#direct-add').hidden, 'direct add changed');
  });
  await test('native opener uses real Dawn components with one product request', async () => {
    mode('theme'); trigger.click(); await tick();
    assert(native.hasAttribute('open') && !qv.overlay.classList.contains('cfp-active'), 'native did not open exclusively');
    assert(fixture.requests.length === 1 && fixture.requests[0].url.endsWith('/fr/products/multi'), 'duplicate or non-localized load');
    assert(native.querySelector('product-info').dataset.updateUrl === 'false', 'native preprocessing missing');
    assert(!native.querySelector('#recommendations'), 'whole page injected');
    assert(!native.querySelector('modal-opener'), 'broken chart popup opener retained');
  });
  await test('app-created product cards also use Theme mode', async () => {
    mode('theme'); await qv.openModal('multi', app);
    assert(native.hasAttribute('open') && !qv.overlay.classList.contains('cfp-active'), 'app card ignored mode');
  });
  await test('native shell is created when Quick Add is loaded without an existing modal', async () => {
    native.remove(); mode('theme');
    try {
      await qv.openModal('multi', app);
      const created = document.querySelector('#QuickAdd-cfp-native');
      assert(created?.hasAttribute('open') && created.querySelector('product-form'), 'native shell not usable');
    } finally { qv.closeModal(); document.querySelector('#QuickAdd-cfp-native')?.remove(); document.body.appendChild(native); }
  });
  await test('native variant changes synchronize ID, price, SKU and image', async () => {
    mode('theme'); await qv.openModal('multi', app);
    const select = native.querySelector('select'); select.value = 'Blue'; select.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    assert(native.querySelector('input[name="id"]').value === '12', 'native variant ID stale');
    assert(native.querySelector('[id^="price-"]').textContent === '€25.00', 'native price stale');
    assert(native.querySelector('[id^="Sku-"]').textContent === 'SKU-12', 'native SKU stale');
    assert(native.querySelector('media-gallery img').alt === 'Blue shirt', 'native image stale');
    assert(!location.search.includes('variant='), 'native changed storefront URL');
  });
  await test('native cart submits selected variant once and closes native dialog', async () => {
    mode('theme'); await qv.openModal('multi', app);
    const select = native.querySelector('select'); select.value = 'Blue'; select.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    const form = native.querySelector('form'); form.requestSubmit(); form.requestSubmit(); await tick();
    const requests = fixture.requests.filter(request => request.url.includes('cart/add.js'));
    assert(requests.length === 1 && requests[0].options.body.get('id') === '12', 'wrong/duplicate native cart payload');
    assert(!native.hasAttribute('open') && window.nativeCartResult.id === 12, 'native cart lifecycle failed');
  });
  await test('native cart errors stay visible and recoverable', async () => {
    mode('theme'); fixture.cartMode = 'error'; await qv.openModal('multi', app);
    native.querySelector('form').requestSubmit(); await tick();
    assert(native.hasAttribute('open') && native.querySelector('.product-form__error-message').textContent.includes('unavailable'), 'native error lost');
    assert(!native.querySelector('[type="submit"]').hasAttribute('aria-disabled'), 'native retry blocked');
  });
  await test('theme product loading failure falls back to App Quick View', async () => {
    mode('theme'); nativeFixture.fail = true; await qv.openModal('multi', app);
    assert(qv.overlay.classList.contains('cfp-active') && !native.hasAttribute('open'), 'load failure has no fallback');
  });
  await test('unsupported product template falls back to App Quick View', async () => {
    mode('theme'); nativeFixture.unsupported = true; await qv.openModal('multi', app);
    assert(qv.overlay.classList.contains('cfp-active') && !native.hasAttribute('open'), 'template failure has no fallback');
  });
  await test('cancelled native response cannot open over a later App Quick View', async () => {
    mode('theme'); nativeFixture.delay = 80; nativeFixture.ignoreAbort = true;
    const pending = qv.openModal('multi', app); mode('app'); await qv.openModal('single', app); await pending;
    assert(!native.hasAttribute('open') && qv.selectedVariantId === 1, 'late native response won');
  });
  await test('late cancelled response cannot clear a newer native modal', async () => {
    mode('theme'); nativeFixture.delay = 80; nativeFixture.ignoreAbort = true;
    const pending = qv.openModal('multi', app); nativeFixture.delay = 0;
    await qv.openModal('multi', trigger); await pending;
    assert(native.hasAttribute('open') && native.querySelector('product-form'), 'stale owner cleared the new modal');
  });
  await test('native timeout falls back without a late native open', async () => {
    mode('theme'); nativeFixture.delay = 80;
    const originalTimer = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) => originalTimer(callback, delay === 10000 ? 10 : delay, ...args);
    try { await qv.openModal('multi', app); assert(qv.overlay.classList.contains('cfp-active') && !native.hasAttribute('open'), 'timeout did not fall back'); }
    finally { window.setTimeout = originalTimer; }
  });
  await test('public settings initialize the mode before search opens', async () => {
    const originalFetch = window.fetch;
    const previousShop = Shopify.shop;
    delete window.cfpGlobalSettings;
    Shopify.shop = 'fixture.myshopify.com';
    let requests = 0;
    window.fetch = async () => { requests++; return { ok: true, json: async () => ({ quickViewStyle: 'theme', showQuickViewCollection: true }) }; };
    try {
      await qv.loadConfiguration();
      assert(requests === 1 && window.cfpGlobalSettings.quickViewStyle === 'theme' && !trigger.hidden, 'bootstrap did not apply mode');
    } finally { window.fetch = originalFetch; Shopify.shop = previousShop; }
  });
  await test('collection response configuration is reused without another API request', async () => {
    const originalFetch = window.fetch;
    const previousShop = Shopify.shop;
    delete window.cfpGlobalSettings;
    Shopify.shop = 'fixture.myshopify.com';
    window._cfpEarlyFetch = Promise.resolve({ globalSettings: { quickViewStyle: 'theme', showQuickViewCollection: true } });
    let requests = 0; window.fetch = async () => { requests++; throw new Error('Unexpected extra request'); };
    try { await qv.loadConfiguration(); assert(requests === 0 && window.cfpGlobalSettings.quickViewStyle === 'theme', 'extra bootstrap request'); }
    finally { window.fetch = originalFetch; Shopify.shop = previousShop; delete window._cfpEarlyFetch; }
  });
  await test('newly rendered native buttons are replaced once and restored on mode change', async () => {
    const wrapper = document.createElement('modal-opener'); wrapper.setAttribute('data-modal', '#QuickAdd-11');
    wrapper.innerHTML = '<button data-product-url="/fr/products/multi">New native opener</button>';
    document.querySelector('.shopify-section').appendChild(wrapper); await tick();
    assert(wrapper.querySelectorAll('[data-cfp-theme-replacement]').length === 1, 'dynamic replacement missing/duplicate');
    mode('theme'); await tick(); assert(!wrapper.querySelector('button').hidden && !wrapper.querySelector('[data-cfp-theme-replacement]'), 'dynamic restoration failed'); wrapper.remove();
  });
  await test('native dialog closes with Escape and restores focus and background', async () => {
    mode('theme'); await qv.openModal('multi', trigger);
    native.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape', bubbles: true })); await tick();
    assert(!native.hasAttribute('open') && !document.querySelector('.shopify-section').inert, 'native background not restored');
    assert(document.activeElement === trigger, 'native opener focus not restored');
  });
  await test('wholesale gating forces App Quick View instead of retail native form', async () => {
    mode('theme'); window.cfpGlobalSettings.isWholesale = true; window.cfpCustomerLoggedIn = false;
    try { await qv.openModal('multi', app); assert(qv.modal.querySelector('.cfp-qv-login-btn') && !native.hasAttribute('open'), 'wholesale bypass'); }
    finally { window.cfpGlobalSettings.isWholesale = false; window.cfpCustomerLoggedIn = true; }
  });
  qv.closeModal(); return results;
};
