window.Shopify = { routes: { root: '/fr/' }, currency: { active: 'EUR' }, theme: { id: 123, role: 'main' } };
window.cfpGlobalSettings = { showQuickViewSizeChart: false, quickViewStyle: 'app' };
window.cfpCustomerLoggedIn = true;
const picture = color => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${color}"/></svg>`)}`;
const images = ['red', 'blue', 'green', 'yellow', 'pink', 'purple', 'gray', 'black', 'orange'].map(picture);
const variant = (id, options, extra = {}) => ({ id, options, price: 1200, compare_at_price: 1500, available: true, sku: `SKU-${id}`, ...extra });
const base = { title: 'Cotton shirt', vendor: 'Example', price: 1200, compare_at_price: 1500, images, featured_image: images[0] };
window.products = {
  single: { ...base, handle: 'single', url: '/products/single', options: [{ name: 'Title', position: 1, values: ['Default Title'] }], variants: [variant(1, ['Default Title'])] },
  multi: { ...base, handle: 'multi', url: '/products/multi', options: [{ name: 'Color', position: 1, values: ['Red', 'Blue'] }, { name: 'Size', position: 2, values: ['S', 'M'] }], variants: [variant(11, ['Red', 'S'], { featured_image: { src: images[0] } }), variant(12, ['Blue', 'S'], { price: 2500, compare_at_price: 3000, featured_image: { src: images[8], position: 9 } }), variant(13, ['Blue', 'M'], { available: false })] },
};
window.fixture = { requests: [], chart: true, cartMode: 'success', productFail: false, delay: 0 };
class FixtureModal extends HTMLElement {
  get open() { return this.hasAttribute('open'); }
  async show() { this.dispatchEvent(new Event('dialog:before-show')); this.setAttribute('open', ''); }
  async hide() { this.removeAttribute('open'); this.dispatchEvent(new Event('dialog:after-hide')); }
}
customElements.define('x-modal', FixtureModal);
window.fetch = async (url, options = {}) => {
  const target = String(url);
  fixture.requests.push({ url: target, options });
  if (fixture.delay) await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, fixture.delay);
    options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
  if (target.includes('cart/add.js')) {
    if (fixture.cartMode === 'network') throw new TypeError('Network error');
    if (fixture.cartMode === 'timeout') throw new DOMException('Aborted', 'AbortError');
    if (fixture.cartMode === 'error') return { ok: false, json: async () => ({ status: 422, description: 'This quantity is unavailable.' }) };
    if (fixture.cartMode === 'server') return { ok: false, json: async () => ({ status: 500, message: 'Please try again later.' }) };
    if (fixture.cartMode === 'html') return { ok: false, json: async () => { throw new SyntaxError('Invalid JSON'); } };
    const body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ items: [{ id: body.items[0].id }],
      sections: Object.fromEntries((body.sections || []).map(id => [id, '<div>Cart</div>'])) }) };
  }
  if (target.endsWith('.js')) {
    const handle = target.split('/').pop().slice(0, -3);
    return { ok: !fixture.productFail, json: async () => structuredClone(products[handle] || products.single) };
  }
  return { ok: true, text: async () => fixture.chart === 'empty'
    ? '<x-modal id="size-chart-shirt"><h2>Size chart</h2><button>Close</button><script>window.unwanted = true;</script></x-modal>'
    : fixture.chart ? '<x-modal id="size-chart-shirt"><button type="button">Close chart</button><table><tr><th>Size</th><th>Chest</th></tr><tr><td>S</td><td>90 cm</td></tr></table><script>window.unwanted = true;</script></x-modal>' : '<main>No size chart</main>' };
};
