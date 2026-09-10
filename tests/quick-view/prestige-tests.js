// Contract doubles, not redistributed commercial theme source. The actual
// Prestige 10.11.0 components are also exercised in an isolated storefront tab.
Object.assign(Shopify.theme, { schema_name: 'Prestige', schema_version: '10.11.0' });
const prestigeFixture = { fail: false, unsupported: false, delay: 0 };
FixtureModal.prototype.hide = function () {
  if (!this.open) return Promise.resolve();
  this.dispatchEvent(new Event('dialog:before-hide'));
  this.removeAttribute('open');
  return new Promise(resolve => setTimeout(() => {
    this.dispatchEvent(new Event('dialog:after-hide')); resolve();
  }, 30));
};
class PrestigeQuickBuy extends FixtureModal {
  constructor() {
    super();
    this.addEventListener('dialog:after-hide', () => this.replaceChildren());
  }
  show() { throw new Error('Uncancellable native loader must not run'); }
}
customElements.define('quick-buy-modal', PrestigeQuickBuy);
const appFetch = window.fetch;
window.fetch = async (url, options = {}) => {
  if (String(url).endsWith('.js')) return appFetch(url, options);
  fixture.requests.push({ url: String(url), options });
  // Deliberately ignore AbortSignal to prove stale responses cannot touch UI.
  const state = { ...prestigeFixture };
  if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
  return { ok: !state.fail, text: async () => state.unsupported ? '<main>No template</main>' : `
    <main id="unrelated">Never import the page</main>
    <template id="quick-buy-content"><div class="quick-buy-modal__content">
      <product-rerender id="quick-buy-modal-content" observe-form="prestige-form">
        <h2 class="product-title">Prestige fixture</h2>
        <form id="prestige-form"><input type="hidden" name="id" value="12"><buy-buttons><button>Add to cart</button></buy-buttons></form>
        <button aria-controls="size-chart-prestige">Size chart</button>
        <x-modal id="size-chart-prestige"><table><tr><td>90 cm</td></tr></table></x-modal>
        <noscript>Remove me</noscript>
      </product-rerender></div></template>` };
};
window.runPrestigeQuickViewTests = async () => {
  const qv = window.cfpQuickViewInstance;
  const app = document.querySelector('#app-trigger');
  const native = document.querySelector('#native-trigger');
  const modal = () => document.querySelector('#cfp-prestige-quick-buy');
  const tick = () => new Promise(resolve => setTimeout(resolve, 50));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const mode = (extra = {}) => qv.configure({ quickViewStyle: 'theme', showQuickViewCollection: true, showQuickViewSizeChart: false, ...extra });
  const results = [];
  const test = async (name, body) => {
    qv.closeModal(); await tick();
    Object.assign(prestigeFixture, { fail: false, unsupported: false, delay: 0 });
    Shopify.theme.schema_version = '10.11.0'; window.cfpCustomerLoggedIn = true;
    fixture.requests = []; mode();
    try { await body(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  };
  await test('Prestige app card loads only the native template with locale', async () => {
    await qv.openModal('multi', app);
    assert(modal().open && !qv.overlay.classList.contains('cfp-active'), 'native not exclusive');
    assert(fixture.requests.length === 1 && fixture.requests[0].url.endsWith('/fr/products/multi'), 'duplicate or wrong request');
    assert(!modal().querySelector('#unrelated, noscript'), 'unexpected page content');
    assert(!modal().querySelector('x-modal, [aria-controls^="size-chart"]'), 'disabled chart present');
  });
  await test('Prestige enabled chart preserves native markup', async () => {
    mode({ showQuickViewSizeChart: true }); await qv.openModal('multi', app);
    assert(modal().querySelector('x-modal table'), 'chart removed');
  });
  await test('Prestige size chart stays above Quick Buy when moved to body', async () => {
    mode({ showQuickViewSizeChart: true }); await qv.openModal('multi', app);
    const chart = modal().querySelector('x-modal');
    const parent = chart.parentElement;
    try {
      // Prestige Modal.shouldAppendToBody moves an open chart out of Quick Buy.
      document.body.append(chart);
      chart.style.cssText = 'display:block;position:fixed;inset:20%;background:white';
      await chart.show();
      const bounds = chart.getBoundingClientRect();
      const front = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      assert(chart.contains(front), 'Quick Buy covers the size chart');
      assert(Number(getComputedStyle(chart).zIndex) > Number(getComputedStyle(modal()).zIndex), 'chart layer is not above Quick Buy');
      await chart.hide();
      assert(modal().open && modal().querySelector('form'), 'closing chart dismissed Quick Buy');
    } finally { parent.append(chart); }
    modal().insertAdjacentHTML('beforeend', '<x-modal id="size-chart-rerender">Chart</x-modal>');
    await tick();
    assert(modal().querySelector('#size-chart-rerender').classList.contains('cfp-native-size-chart'), 'rerendered chart lost its layer');
  });
  await test('Prestige chart policy survives product rerender', async () => {
    await qv.openModal('multi', app);
    modal().insertAdjacentHTML('beforeend', '<button aria-controls="size-chart-new">Chart</button><x-modal id="size-chart-new">Chart</x-modal>');
    await tick(); assert(!modal().querySelector('x-modal, [aria-controls^="size-chart"]'), 'rerender restored chart');
  });
  await test('Prestige native button is replaced and restored by App mode', async () => {
    mode({ quickViewStyle: 'app' });
    assert(native.hidden && document.querySelector('[data-cfp-theme-replacement]'), 'not replaced');
    mode(); assert(!native.hidden && !document.querySelector('[data-cfp-theme-replacement]'), 'not restored');
    assert(CfpQuickViewAdapters.getNativeTrigger(native)?.handle === 'multi', 'native trigger missing');
  });
  await test('Disabling collection Quick View restores Prestige controls', async () => {
    mode({ quickViewStyle: 'app' }); mode({ quickViewStyle: 'app', showQuickViewCollection: false });
    assert(!native.hidden && !document.querySelector('[data-cfp-theme-replacement]'), 'theme control hidden');
  });
  for (const failure of ['fail', 'unsupported']) await test(`Prestige ${failure} falls back to App`, async () => {
    prestigeFixture[failure] = true; await qv.openModal('multi', app);
    assert(qv.overlay.classList.contains('cfp-active') && !modal()?.open, 'fallback missing');
  });
  await test('Prestige cancelled response cannot replace a newer product', async () => {
    prestigeFixture.delay = 100; const old = qv.openModal('single', app);
    await tick(); prestigeFixture.delay = 0; await qv.openModal('multi', app); await old;
    assert(modal().open && modal().getAttribute('handle') === 'multi' && modal().querySelector('form'), 'stale response changed popup');
  });
  await test('Prestige close animation cannot erase a reopened popup', async () => {
    await qv.openModal('single', app); qv.closeModal(); await qv.openModal('multi', app); await tick();
    assert(modal().open && modal().querySelector('form'), 'old hide cleared new content');
  });
  await test('Prestige native dismissal can immediately reopen safely', async () => {
    await qv.openModal('single', app); modal().hide(); await qv.openModal('multi', app); await tick();
    assert(modal().open && modal().querySelector('form'), 'native hide cleared new content');
  });
  await test('Unverified Prestige versions use App fallback', async () => {
    Shopify.theme.schema_version = '9.0.0'; await qv.openModal('multi', app);
    assert(qv.overlay.classList.contains('cfp-active'), 'version guard missing');
  });
  await test('Prestige cannot bypass wholesale gating', async () => {
    window.cfpCustomerLoggedIn = false; mode({ isWholesale: true }); await qv.openModal('multi', app);
    assert(qv.overlay.classList.contains('cfp-active') && !modal()?.open, 'wholesale bypass');
  });
  qv.closeModal(); await tick(); return results;
};
