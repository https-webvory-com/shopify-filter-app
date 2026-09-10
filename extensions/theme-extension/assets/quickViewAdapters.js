/* global HTMLUpdateUtility */
// Native integrations use explicit component contracts, never guessed click selectors.
if (!window.CfpQuickViewAdapters) {
  const nativeSelector = 'modal-opener[data-modal^="#QuickAdd-"] button[data-product-url]';
  const replacements = new Map();
  let configuration = null;
  let scheduled = false;
  const nativeOwners = new WeakMap();

  const handleFrom = button => {
    try {
      const url = new URL(button.getAttribute('data-product-url'), location.origin);
      if (url.origin !== location.origin) return null;
      return decodeURIComponent(url.pathname.match(/\/products\/([^/]+)/)?.[1] || '') || null;
    } catch { return null; }
  };
  const nativeModal = trigger => {
    const id = trigger?.closest('modal-opener')?.getAttribute('data-modal')?.slice(1);
    return (id && document.getElementById(id)) || document.querySelector('quick-add-modal');
  };
  const hasDawnContract = modal => Boolean(
    modal?.matches('quick-add-modal') && typeof modal.preprocessHTML === 'function' &&
    typeof modal.hide === 'function' && modal.querySelector('[id^="QuickAddInfo-"]') &&
    modal.querySelector('[role="dialog"]') && getComputedStyle(modal).position === 'fixed' &&
    typeof customElements.get('modal-dialog')?.prototype.show === 'function' &&
    typeof HTMLUpdateUtility !== 'undefined' && typeof HTMLUpdateUtility.setInnerHTML === 'function'
  );
  const ensureNativeModal = trigger => {
    const existing = nativeModal(trigger);
    if (existing) return existing;
    // A collection containing only single-variant products may load Quick Add's
    // scripts/styles without rendering a modal. Build its documented empty shell.
    if (typeof customElements.get('quick-add-modal')?.prototype.preprocessHTML !== 'function') return null;
    const template = document.createElement('template');
    template.innerHTML = '<quick-add-modal id="QuickAdd-cfp-native" class="quick-add-modal"><div role="dialog" aria-modal="true" aria-label="Product quick view" tabindex="-1" class="quick-add-modal__content global-settings-popup"><button type="button" id="ModalClose-cfp-native" class="quick-add-modal__toggle" aria-label="Close">&times;</button><div id="QuickAddInfo-cfp-native" class="quick-add-modal__content-info"></div></div></quick-add-modal>';
    const modal = template.content.firstElementChild;
    modal.moved = true;
    modal.dataset.section = 'cfp-native';
    document.body.appendChild(modal);
    if (!hasDawnContract(modal)) { modal.remove(); return null; }
    return modal;
  };

  const restore = (button, saved) => {
    const focused = document.activeElement === saved.replacement;
    button.hidden = saved.hidden;
    if (saved.display) button.style.setProperty('display', saved.display, saved.priority);
    else button.style.removeProperty('display');
    saved.replacement.remove();
    replacements.delete(button);
    if (focused && button.isConnected) button.focus();
  };
  const reconcile = () => {
    scheduled = false;
    const appMode = configuration?.quickViewStyle !== 'theme' && configuration?.showQuickViewCollection !== false;
    replacements.forEach((saved, button) => {
      if (!appMode || !button.isConnected || !handleFrom(button)) restore(button, saved);
      else {
        saved.replacement.dataset.productHandle = handleFrom(button);
        if (saved.replacement.disabled !== button.disabled) saved.replacement.disabled = button.disabled;
        if (!saved.replacement.isConnected) button.after(saved.replacement);
      }
    });
    if (!configuration || !appMode) return;
    document.querySelectorAll(nativeSelector).forEach(button => {
      if (replacements.has(button) || button.hidden || getComputedStyle(button).display === 'none' || !handleFrom(button)) return;
      // Only replace actual Quick Add dialog openers, never one-click Add to Cart.
      if (!nativeModal(button)?.matches('quick-add-modal')) return;
      const replacement = document.createElement('button');
      replacement.type = 'button';
      replacement.className = button.className;
      replacement.textContent = 'Quick View';
      replacement.dataset.cfpThemeReplacement = '';
      replacement.dataset.productHandle = handleFrom(button);
      replacement.setAttribute('aria-haspopup', 'dialog');
      replacement.disabled = button.disabled;
      const focused = document.activeElement === button;
      replacements.set(button, { replacement, hidden: button.hidden, display: button.style.getPropertyValue('display'), priority: button.style.getPropertyPriority('display') });
      button.hidden = true;
      button.style.setProperty('display', 'none', 'important');
      button.after(replacement);
      if (focused) replacement.focus();
    });
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(reconcile);
  };
  const observer = new MutationObserver(schedule);

  const dawnAdapter = modal => {
    const owner = Symbol('quick-view');
    let opened = false;
    let lifecycle = null;
    let previousLabel = null;
    let background = [];
    let opener = null;
    let onProductLoaded = null;
    const reset = () => {
      if (nativeOwners.get(modal) !== owner) return;
      lifecycle?.disconnect();
      lifecycle = null;
      if (onProductLoaded) modal.removeEventListener('product-info:loaded', onProductLoaded);
      modal.classList.remove('cfp-native-quick-view');
      const dialog = modal.querySelector('[role="dialog"]');
      if (dialog && previousLabel !== null) dialog.setAttribute('aria-label', previousLabel);
      background.forEach(([element, inert]) => { element.inert = inert; });
      background = [];
      if (opener?.isConnected && (document.activeElement === document.body || modal.contains(document.activeElement))) opener.focus();
      opened = false;
      nativeOwners.delete(modal);
    };
    return {
      id: 'dawn-quick-add',
      async open({ handle, trigger, settings, signal }) {
        nativeOwners.set(modal, owner);
        const url = new URL(`${window.Shopify?.routes?.root || '/'}products/${encodeURIComponent(handle)}`, location.origin);
        if (window.Shopify?.theme?.role === 'unpublished') url.searchParams.set('preview_theme_id', window.Shopify.theme.id);
        const response = await fetch(url, { signal, credentials: 'same-origin' });
        if (!response.ok) throw new Error('Theme Quick View could not load the product');
        const page = new DOMParser().parseFromString(await response.text(), 'text/html');
        signal.throwIfAborted();
        const product = page.querySelector('product-info[data-section]');
        if (!product?.querySelector('product-form')) throw new Error('Unsupported theme product section');
        // Use Dawn's own Quick Add preprocessing and rendering. This excludes the
        // rest of the page and keeps the theme's variant/price/media/cart components.
        modal.preprocessHTML(product);
        const prunePopups = product => {
          if (!settings.showQuickViewSizeChart) {
            product.querySelectorAll('[data-size-chart], .size-chart, .size-chart-link, x-modal[id^="size-chart"], x-modal.custom-size-chart-modal').forEach(node => node.remove());
          }
          product.querySelectorAll('modal-opener[data-modal], [aria-controls]').forEach(opener => {
          const reference = opener.getAttribute('data-modal')?.slice(1) || opener.getAttribute('aria-controls');
          // Native Quick Add removes product popup dialogs; remove their orphan
          // openers as well so size charts and other popups never become dead links.
          if (reference && !product.querySelector(`[id="${CSS.escape(reference)}"]`) &&
              (opener.matches('modal-opener') || /size.?chart/i.test(reference))) opener.remove();
          });
        };
        prunePopups(product);
        // Product swaps performed by the theme must keep the same popup policy.
        onProductLoaded = ({ target }) => target.addPreProcessCallback?.(prunePopups);
        modal.addEventListener('product-info:loaded', onProductLoaded);
        const content = modal.querySelector('[id^="QuickAddInfo-"]');
        HTMLUpdateUtility.setInnerHTML(content, product.outerHTML);
        const components = ['product-info', 'product-form', 'variant-selects'].filter(name => content.querySelector(name));
        let abort;
        try {
          await Promise.race([
            Promise.all(components.map(name => customElements.whenDefined(name))),
            new Promise((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); }),
          ]);
        } finally { signal.removeEventListener('abort', abort); }
        signal.throwIfAborted();
        modal.classList.add('cfp-native-quick-view');
        const dialog = modal.querySelector('[role="dialog"]');
        previousLabel = dialog.getAttribute('aria-label') || '';
        dialog.setAttribute('aria-label', product.querySelector('h1, h2')?.textContent.trim() || 'Product quick view');
        opener = trigger;
        background = [...document.body.children].filter(element => element !== modal).map(element => [element, element.inert]);
        background.forEach(([element]) => { element.inert = true; });
        // The base dialog opens synchronously; the original fire-and-forget loader
        // is deliberately bypassed so cancellation cannot open a second modal later.
        customElements.get('modal-dialog').prototype.show.call(modal, trigger);
        opened = true;
        lifecycle = new MutationObserver(() => { if (!modal.hasAttribute('open')) reset(); });
        lifecycle.observe(modal, { attributes: true, attributeFilter: ['open'] });
        return true;
      },
      close() {
        if (nativeOwners.get(modal) !== owner) return;
        try {
          if (opened || modal.hasAttribute('open')) modal.hide(true);
          else modal.querySelector('[id^="QuickAddInfo-"]').replaceChildren();
        } finally { reset(); }
      },
    };
  };
  window.CfpQuickViewAdapters = {
    closeOpenNative() {
      document.querySelectorAll('quick-add-modal[open]').forEach(modal => {
        if (hasDawnContract(modal)) modal.hide(true);
      });
    },
    configure(settings) {
      configuration = settings;
      observer.disconnect();
      reconcile();
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-product-url', 'disabled'] });
    },
    getNativeTrigger(target) {
      const button = target.closest(nativeSelector);
      return button && handleFrom(button) && nativeModal(button)?.matches('quick-add-modal') ? { button, handle: handleFrom(button) } : null;
    },
    getQuickView({ trigger, settings }) {
      // App-owned wholesale gating must not be bypassed by a retail theme form.
      if (settings.isWholesale && !window.cfpCustomerLoggedIn) return null;
      const modal = ensureNativeModal(trigger);
      return hasDawnContract(modal) ? dawnAdapter(modal) : null;
    },
    supportsSizeChart() {
      const modal = window.customElements.get('x-modal');
      return Boolean(modal && typeof modal.prototype.show === 'function' && typeof modal.prototype.hide === 'function');
    },
    getSizeChart(page) {
      if (!this.supportsSizeChart()) return null;
      const chart = page.querySelector('x-modal.custom-size-chart-modal, x-modal[id^="size-chart"]');
      if (!chart) return null;
      const content = chart.cloneNode(true);
      content.querySelectorAll('script, style, button, h1, h2, h3, h4, h5, h6, [slot="header"], [slot="title"]').forEach(element => element.remove());
      return content.textContent.trim() || content.querySelector('img[src]') ? chart : null;
    },
    renderCart(data, trigger) {
      const drawer = document.querySelector('cart-drawer');
      if (!drawer || typeof drawer.renderContents !== 'function' || !data.sections ||
          Object.values(data.sections).some(section => section === null)) return false;
      drawer.setActiveElement?.(trigger);
      drawer.classList.remove('is-empty');
      drawer.querySelector('.drawer__inner')?.classList.remove('is-empty');
      drawer.renderContents(data);
      return true;
    },
    getCartSections() {
      const drawer = document.querySelector('cart-drawer');
      try {
        return drawer?.getSectionsToRender?.().map(section => section.id).slice(0, 5) || ['cart-drawer', 'cart-icon-bubble'];
      } catch {
        return ['cart-drawer', 'cart-icon-bubble'];
      }
    },
    notifyCartAdded(data) {
      document.dispatchEvent(new CustomEvent('ajaxProduct:added', { detail: { product: data } }));
      document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart: data } }));
      window.dispatchEvent(new Event('cart:refresh'));
      window.dispatchEvent(new CustomEvent('cart:build', { bubbles: true }));
    },
    isCartOpen() {
      // Do not mistake an unrelated .is-open dialog (such as search) for the cart.
      return Boolean(document.querySelector('cart-drawer.is-active, cart-drawer.active, .cart-drawer.is-open, .cart-drawer--open, .cart-notification.active, #CartDrawer.active, #CartDrawer.is-open'));
    },
  };
}
