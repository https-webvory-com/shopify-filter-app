window.variantStrings = { addToCart: 'Add to cart', soldOut: 'Sold out', unavailable: 'Unavailable' };
window.routes = { cart_add_url: '/fr/cart/add.js', cart_url: '/fr/cart' };
window.CartPerformance = { createStartingMarker() {}, measureFromMarker() {}, measureFromEvent() {}, measure(name, callback) { callback(); } };
const fixtureCart = document.querySelector('cart-drawer');
fixtureCart.getSectionsToRender = () => [{ id: 'cart-drawer' }];
fixtureCart.setActiveElement = () => {};
fixtureCart.renderContents = data => { window.nativeCartResult = data; };
window.nativeFixture = { fail: false, unsupported: false, delay: 0, ignoreAbort: false };
window.nativeHTML = (id = 11) => {
  const variant = products.multi.variants.find(item => item.id === id);
  const color = id === 11 ? 'Red' : 'Blue';
  return `<main><h1>Page content outside Quick View</h1><product-info id="MainProduct-section-main" data-section="section-main" data-url="/fr/products/multi" data-update-url="true"><div class="product">
    <h2>Cotton shirt</h2><div id="price-section-main">${id === 11 ? '€12.00' : '€25.00'}</div><div id="Sku-section-main">SKU-${id}</div>
    <media-gallery><ul><li data-media-id="section-main-${id}"><img alt="${color} shirt" src="${products.multi.images[id === 11 ? 0 : 8]}"></li></ul></media-gallery>
    <variant-selects data-section="section-main"><div class="product-form__input product-form__input--dropdown"><label for="Option-section-main">Color</label><select id="Option-section-main"><option id="Red-section-main" data-option-value-id="red" value="Red" ${id === 11 ? 'selected="selected"' : ''}>Red</option><option id="Blue-section-main" data-option-value-id="blue" value="Blue" ${id !== 11 ? 'selected="selected"' : ''}>Blue</option></select></div><script type="application/json" data-selected-variant>${JSON.stringify({ ...variant, featured_media: { id } })}</script></variant-selects>
    <product-form><div class="product-form__error-message-wrapper" role="alert" hidden><span class="product-form__error-message"></span></div><form id="product-form-section-main" action="/fr/cart/add"><input type="hidden" name="id" value="${id}"><button type="submit" id="ProductSubmitButton-section-main" ${variant.available ? '' : 'disabled'}><span>Add to cart</span><span class="loading__spinner hidden">Loading</span></button></form></product-form>
    <modal-opener data-modal="#PopupModal-section-main"><button>Size chart</button></modal-opener><modal-dialog id="PopupModal-section-main"><button id="ModalClose-chart">Close</button><table><tr><td>Size chart</td></tr></table></modal-dialog>
    </div></product-info><section id="recommendations">Unrelated recommendations</section></main>`;
};
const appFetch = window.fetch;
window.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.includes('cart/add.js') && options.body instanceof FormData) {
    fixture.requests.push({ url: target, options });
    const id = Number(options.body.get('id'));
    return { ok: fixture.cartMode === 'success', json: async () => fixture.cartMode === 'success'
      ? { id, sections: { 'cart-drawer': '<div>Cart</div>' } }
      : { status: 422, description: 'This variant is unavailable.' } };
  }
  if (!target.endsWith('.js') && target.includes('/products/')) {
    fixture.requests.push({ url: target, options });
    if (nativeFixture.delay) await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, nativeFixture.delay);
      if (!nativeFixture.ignoreAbort) options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
    return { ok: !nativeFixture.fail, text: async () => nativeFixture.unsupported ? '<main>Unsupported template</main>' : nativeHTML(target.includes('option_values=blue') ? 12 : 11) };
  }
  return appFetch(url, options);
};
