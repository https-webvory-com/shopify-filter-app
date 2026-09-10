window.runQuickViewTests = async () => {
  const qv = window.cfpQuickViewInstance;
  const results = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const tick = () => new Promise(resolve => setTimeout(resolve, 20));
  const button = () => qv.modal.querySelector('.cfp-qv-add-to-cart-btn');
  const chart = () => qv.modal.querySelector('.cfp-qv-size-chart');
  const open = async (handle = 'single', settings = {}) => {
    qv.closeModal();
    fixture.requests = []; fixture.delay = 0; fixture.productFail = false;
    window.cfpGlobalSettings = { showQuickViewSizeChart: false, quickViewStyle: 'app', ...settings };
    await qv.openModal(handle, document.querySelector('#collection'));
    await tick();
  };
  const test = async (name, body) => {
    try { await body(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  };
  await test('single default variant is purchasable and preserves full SKU', async () => {
    await open(); assert(qv.selectedVariantId === 1 && !button().disabled, 'default variant unavailable');
    assert(qv.modal.querySelector('.cfp-qv-sku').textContent === 'SKU-1', 'SKU truncated');
  });
  for (const hasChart of [false, true]) {
    for (const enabled of [false, true]) {
      await test(`chart enabled=${enabled}, exists=${hasChart}`, async () => {
        fixture.chart = hasChart; qv.chartCache.clear();
        await open('multi', { showQuickViewSizeChart: enabled });
        assert(chart().hidden === !(enabled && hasChart), 'incorrect visibility');
        assert(fixture.requests.filter(r => !r.url.endsWith('.js')).length === (enabled ? 1 : 0), 'unnecessary chart request');
        assert(!window.unwanted, 'product script executed');
      });
    }
  }
  await test('chart click uses detected content without a second fetch', async () => {
    fixture.chart = true; qv.chartCache.clear(); await open('multi', { showQuickViewSizeChart: true });
    const count = fixture.requests.length; chart().click(); await tick();
    assert(qv.sizeChart.open && fixture.requests.length === count, 'chart refetched or failed');
    await qv.sizeChart.hide();
  });
  await test('empty chart shell does not expose a link', async () => {
    fixture.chart = 'empty'; qv.chartCache.clear(); await open('multi', { showQuickViewSizeChart: true });
    assert(chart().hidden, 'empty chart shown'); fixture.chart = true;
  });
  await test('multiple options synchronize price, image, ID and invalid selection', async () => {
    await open('multi');
    qv.modal.querySelector('[data-value="Blue"]').click();
    assert(qv.selectedVariantId === 12, 'wrong variant');
    assert(qv.modal.querySelector('.cfp-qv-price').textContent === qv.money(2500), 'wrong price');
    assert(qv.modal.querySelector('.cfp-qv-compare-price').textContent === qv.money(3000), 'wrong compare price');
    assert(qv.modal.querySelector('.cfp-qv-carousel-track img').src === products.multi.variants[1].featured_image.src, 'capped variant image wrong');
    qv.modal.querySelector('[data-value="M"]').click();
    assert(qv.selectedVariantId === 13 && button().disabled, 'sold out state');
    qv.modal.querySelector('[data-value="Red"]').click();
    assert(qv.selectedVariantId === null && button().disabled, 'stale invalid ID');
  });
  await test('variant without an image returns to the product image', async () => {
    await open('multi'); qv.modal.querySelector('[data-value="Blue"]').click();
    qv.modal.querySelector('[data-value="M"]').click();
    const active = qv.carouselImages.findIndex(src => src === products.multi.featured_image);
    const offset = parseFloat(qv.modal.querySelector('.cfp-qv-carousel-track').style.transform.slice('translateX('.length));
    assert(active >= 0 && offset === -active * 100, 'previous variant image retained');
  });
  await test('unsupported chart bridge performs no HTML fetch', async () => {
    const original = CfpQuickViewAdapters.supportsSizeChart;
    CfpQuickViewAdapters.supportsSizeChart = () => false;
    try { await open('multi', { showQuickViewSizeChart: true }); assert(chart().hidden && fixture.requests.length === 1, 'unsupported chart fetched'); }
    finally { CfpQuickViewAdapters.supportsSizeChart = original; }
  });
  await test('closing during chart detection cannot reveal a stale chart', async () => {
    await open('multi'); fixture.delay = 40; qv.settings.showQuickViewSizeChart = true;
    const pending = qv.openSizeChart(qv.currentProduct, chart(), true); qv.closeModal(); await pending;
    assert(!qv.sizeChart && !qv.overlay.classList.contains('cfp-active'), 'stale chart survived close');
  });
  await test('untracked and continue-selling availability use Shopify available', async () => {
    for (const fields of [{ inventory_management: null }, { inventory_policy: 'continue', inventory_quantity: 0 }]) {
      Object.assign(products.single.variants[0], fields); await open(); assert(!button().disabled, 'available variant blocked');
    }
  });
  await test('sold-out single variant cannot submit', async () => {
    products.single.variants[0].available = false; await open(); await qv.addToCart();
    assert(button().disabled && !fixture.requests.some(r => r.url.includes('cart/add')), 'sold out submitted');
    products.single.variants[0].available = true;
  });
  await test('locale-aware request and product link', async () => {
    await open(); assert(fixture.requests[0].url === '/fr/products/single.js', 'locale missing');
    assert(qv.modal.querySelector('.cfp-qv-view-details-link').pathname.startsWith('/fr/'), 'link locale missing');
    Shopify.routes.root = '/'; await open(); assert(fixture.requests[0].url === '/products/single.js', 'default locale broken'); Shopify.routes.root = '/fr/';
  });
  for (const mode of ['error', 'server', 'html', 'network', 'timeout']) {
    await test(`recoverable cart failure: ${mode}`, async () => {
      await open(); fixture.cartMode = mode; await qv.addToCart();
      assert(qv.overlay.classList.contains('cfp-active') && !button().disabled, 'failure closed/stuck');
      assert(qv.modal.querySelector('.cfp-qv-cart-status').textContent.length > 0, 'no useful error');
    });
  }
  await test('duplicate cart submission blocked and correct selected variant sent', async () => {
    await open('multi'); qv.modal.querySelector('[data-value="Blue"]').click(); fixture.cartMode = 'error'; fixture.delay = 40;
    await Promise.all([qv.addToCart(), qv.addToCart()]);
    const requests = fixture.requests.filter(r => r.url.includes('cart/add'));
    assert(requests.length === 1 && JSON.parse(requests[0].options.body).items[0].id === 12, 'wrong or duplicate cart payload');
  });
  await test('successful cart closes and restores focus before drawer', async () => {
    await open(); fixture.cartMode = 'success';
    const original = CfpQuickViewAdapters.renderCart;
    let called = false; let restored = false;
    CfpQuickViewAdapters.renderCart = () => { called = true; restored = document.activeElement.id === 'collection'; return true; };
    try { await qv.addToCart(); assert(called && restored && !qv.overlay.classList.contains('cfp-active'), 'success or focus restoration not completed'); }
    finally { CfpQuickViewAdapters.renderCart = original; }
  });
  await test('unsupported theme and failed adapter use App default', async () => {
    await open('single', { quickViewStyle: 'theme' }); assert(!button().disabled, 'unsupported fallback failed');
    const original = CfpQuickViewAdapters.getQuickView;
    CfpQuickViewAdapters.getQuickView = () => ({ open: async () => { throw new Error('theme failure'); }, close() {} });
    try { await open('single', { quickViewStyle: 'theme' }); assert(!button().disabled, 'failure fallback failed'); }
    finally { CfpQuickViewAdapters.getQuickView = original; }
  });
  await test('in-flight product requests coalesce', async () => {
    fixture.requests = []; fixture.delay = 40;
    await Promise.all([qv.loadProduct('single'), qv.loadProduct('single')]);
    assert(fixture.requests.length === 1, 'duplicate fetch'); fixture.delay = 0;
  });
  await test('product errors have retry and close', async () => {
    fixture.productFail = true; await qv.openModal('single');
    assert(qv.modal.querySelector('.cfp-qv-retry') && qv.modal.querySelector('.cfp-quick-view-close'), 'no recovery');
    fixture.productFail = false; qv.modal.querySelector('.cfp-qv-retry').click(); await tick(); assert(button(), 'retry failed');
  });
  await test('dialog focus, Tab trap, Escape and restoration', async () => {
    await open(); assert(qv.modal.getAttribute('aria-modal') === 'true', 'missing semantics');
    assert(document.activeElement.classList.contains('cfp-quick-view-close'), 'initial focus');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert(document.activeElement.classList.contains('cfp-qv-view-details-link'), 'focus not wrapped');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(document.activeElement.id === 'collection' && !document.querySelector('#outside').inert && !document.body.style.overflow, 'cleanup failed');
  });
  await test('Escape closes only the topmost image viewer', async () => {
    await open(); qv.modal.querySelector('.cfp-qv-zoom-btn').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(!qv.lightbox.classList.contains('cfp-active') && qv.overlay.classList.contains('cfp-active'), 'wrong dialog closed');
  });
  await test('focus trap handles theme controls in shadow DOM', async () => {
    await open();
    const host = document.createElement('div');
    host.attachShadow({ mode: 'open' }).innerHTML = '<button>Theme control</button>';
    qv.modal.appendChild(host);
    host.shadowRoot.querySelector('button').focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert(document.activeElement.classList.contains('cfp-quick-view-close'), 'shadow focus escaped');
  });
  await test('both card entry points open the shared modal', async () => {
    for (const id of ['collection', 'search']) {
      qv.closeModal(); document.getElementById(id).click(); await tick();
      assert(qv.overlay.classList.contains('cfp-active') && button(), `${id} failed`);
    }
  });
  qv.closeModal();
  document.querySelector('#results').textContent = JSON.stringify(results, null, 2);
  return results;
};

window.runQuickViewLayoutTest = async () => {
  const qv = cfpQuickViewInstance;
  const original = products.multi;
  products.multi = structuredClone(original);
  products.multi.title = 'A long product title with multiple colors and many sizes for a cotton shirt';
  products.multi.options[1].values = Array.from({ length: 20 }, (_, index) => `Size ${index + 1}`);
  products.multi.variants = products.multi.options[1].values.map((size, index) => ({ ...original.variants[0], id: index + 100, options: ['Red', size] }));
  try {
    await qv.openModal('multi', document.querySelector('#collection'));
    await new Promise(requestAnimationFrame);
    await Promise.all(qv.modal.getAnimations().map(animation => animation.finished.catch(() => {})));
    qv.modal.scrollTop = qv.modal.scrollHeight;
    const details = qv.modal.querySelector('.cfp-quick-view-details');
    details.scrollTop = details.scrollHeight;
    const m = qv.modal.getBoundingClientRect();
    const c = qv.modal.querySelector('.cfp-quick-view-close').getBoundingClientRect();
    const cart = qv.modal.querySelector('.cfp-qv-add-to-cart-btn').getBoundingClientRect();
    return { viewport: [innerWidth, innerHeight], fits: m.left >= 0 && m.right <= innerWidth && m.top >= 0 && m.bottom <= innerHeight,
      closeVisible: c.top >= m.top && c.bottom <= m.bottom, cartVisible: cart.top >= m.top && cart.bottom <= m.bottom,
      overflow: qv.modal.scrollWidth > qv.modal.clientWidth };
  } finally { products.multi = original; qv.closeModal(); }
};
