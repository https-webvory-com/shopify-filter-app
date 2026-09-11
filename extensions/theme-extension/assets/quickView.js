if (typeof window.CfpQuickView === 'undefined') {
  window.CfpQuickView = class CfpQuickView {
    constructor() {
      this.modal = null;
      this.overlay = null;
      this.productRequests = new Map();
      this.chartCache = new Map();
      this.cartPending = false;
      this.init();
    }

    init() {
      this.createModalDOM();
      this.attachEventListeners();
      this.loadConfiguration();
    }

    configure(settings) {
      if ((window.cfpGlobalSettings?.quickViewStyle !== settings.quickViewStyle ||
           window.cfpGlobalSettings?.quickViewInstantSearchStyle !== settings.quickViewInstantSearchStyle) &&
          (this.nativeAdapter || this.overlay.classList.contains('cfp-active'))) this.closeModal();
      this.configurationVersion = (this.configurationVersion || 0) + 1;
      window.cfpGlobalSettings = { ...window.cfpGlobalSettings, ...settings };
      if (settings.quickViewStyle === 'app' && settings.showQuickViewCollection !== false) window.CfpQuickViewAdapters?.closeOpenNative();
      window.CfpQuickViewAdapters?.configure(window.cfpGlobalSettings);
    }

    async loadConfiguration() {
      if (window.cfpGlobalSettings) { this.configure(window.cfpGlobalSettings); return; }
      if (!window.Shopify?.shop) return;
      const version = this.configurationVersion || 0;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        let settings;
        if (window._cfpEarlyFetch) {
          // Collection pages already request these flags; reuse that response.
          let abort;
          const data = await Promise.race([
            window._cfpEarlyFetch,
            new Promise(resolve => { abort = () => resolve(null); controller.signal.addEventListener('abort', abort, { once: true }); }),
          ]);
          controller.signal.removeEventListener('abort', abort);
          settings = data?.globalSettings;
        }
        if (!settings) {
          const url = new URL('/api/quick-view', window.API_DOMAIN || 'https://aisearchfilter.webvory.com');
          url.searchParams.set('shop', window.Shopify.shop);
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) return;
          settings = await response.json();
        }
        if ((this.configurationVersion || 0) === version && settings) this.configure(settings);
      } catch { /* Preserve native controls when configuration cannot be loaded. */ }
      finally { clearTimeout(timeout); }
    }

    createModalDOM() {
      // Create overlay
      this.overlay = document.createElement('div');
      this.overlay.className = 'cfp-quick-view-overlay';
      
      // Create modal
      this.modal = document.createElement('div');
      this.modal.className = 'cfp-quick-view-modal';
      this.modal.setAttribute('role', 'dialog');
      this.modal.setAttribute('aria-modal', 'true');
      this.modal.setAttribute('aria-label', 'Product quick view');
      this.modal.tabIndex = -1;
      
      this.overlay.appendChild(this.modal);
      document.body.appendChild(this.overlay);

      // Close on overlay click
      this.overlay.addEventListener('click', (e) => {
        if (e.target === this.overlay) {
          this.closeModal();
        }
      });

      // Create Lightbox
      this.lightbox = document.createElement('div');
      this.lightbox.className = 'cfp-lightbox-overlay';
      this.lightbox.setAttribute('role', 'dialog');
      this.lightbox.setAttribute('aria-modal', 'true');
      this.lightbox.setAttribute('aria-label', 'Product images');
      this.lightbox.tabIndex = -1;
      this.lightbox.innerHTML = `
        <div class="cfp-lightbox-content">
          <img class="cfp-lightbox-img" src="" alt="Zoomed Product">
          <div class="cfp-lightbox-controls">
            <button class="cfp-lightbox-btn" id="cfp-lightbox-prev">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <button class="cfp-lightbox-btn" id="cfp-lightbox-close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <button class="cfp-lightbox-btn" id="cfp-lightbox-next">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(this.lightbox);

      // Lightbox event listeners
      this.lightbox.querySelector('#cfp-lightbox-close').addEventListener('click', () => {
        this.closeLightbox();
      });
      this.lightbox.querySelector('#cfp-lightbox-prev').addEventListener('click', () => this.navigateLightbox(-1));
      this.lightbox.querySelector('#cfp-lightbox-next').addEventListener('click', () => this.navigateLightbox(1));
      ['prev', 'close', 'next'].forEach((name, index) => {
        this.lightbox.querySelector(`#cfp-lightbox-${name}`).setAttribute('aria-label', ['Previous image', 'Close image viewer', 'Next image'][index]);
      });
      
      this.currentLightboxImages = [];
      this.currentLightboxIndex = 0;
    }

    openLightbox(images, startIndex) {
      this.currentLightboxImages = images;
      this.currentLightboxIndex = startIndex;
      this.updateLightboxImage();
      this.lightbox.classList.add('cfp-active');
      this.modal.inert = true;
      this.lightbox.querySelector('#cfp-lightbox-close').focus();
    }

    closeLightbox() {
      this.lightbox.classList.remove('cfp-active');
      this.modal.inert = false;
      this.modal.querySelector('.cfp-qv-zoom-btn')?.focus();
    }

    updateLightboxImage() {
      const imgElement = this.lightbox.querySelector('.cfp-lightbox-img');
      if (this.currentLightboxImages.length > 0) {
        imgElement.src = this.currentLightboxImages[this.currentLightboxIndex];
      }
    }

    navigateLightbox(direction) {
      if (this.currentLightboxImages.length === 0) return;
      this.currentLightboxIndex += direction;
      if (this.currentLightboxIndex < 0) {
        this.currentLightboxIndex = this.currentLightboxImages.length - 1;
      } else if (this.currentLightboxIndex >= this.currentLightboxImages.length) {
        this.currentLightboxIndex = 0;
      }
      this.updateLightboxImage();
    }

    attachEventListeners() {
      document.addEventListener('keydown', event => {
        if (this.nativeController && event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.closeModal();
          return;
        }
        if (!this.overlay.classList.contains('cfp-active')) return;
        const chart = this.sizeChart?.open ? this.sizeChart : null;
        const zoomed = this.lightbox.classList.contains('cfp-active');
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (chart) Promise.resolve(chart.hide()).catch(() => this.clearSizeChart());
          else if (zoomed) this.closeLightbox();
          else this.closeModal();
        } else if (event.key === 'Tab') {
          const container = chart || (zoomed ? this.lightbox : this.modal);
          const controls = this.focusableElements(container);
          const first = controls[0] || container;
          const last = controls[controls.length - 1] || container;
          let active = document.activeElement;
          while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
          if (!container.contains(document.activeElement) || (event.shiftKey && active === first) ||
              (!event.shiftKey && active === last) || active === container) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          }
        }
      }, true);
      // Use event delegation for dynamically loaded product cards
      document.addEventListener('click', (e) => {
        const native = window.cfpGlobalSettings?.showQuickViewCollection !== false && window.cfpGlobalSettings
          ? window.CfpQuickViewAdapters?.getNativeTrigger(e.target) : null;
        const btn = e.target.closest('.cfp-quick-view-btn, [data-cfp-theme-replacement]') || native?.button;
        if (btn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (btn.disabled || btn.getAttribute('aria-busy') === 'true') return;
          const handle = btn.getAttribute('data-product-handle') || native?.handle;
          if (handle) {
            this.openModal(handle, btn);
          }
        }
      }, true);
    }

    focusableElements(container) {
      const controls = [];
      const visit = element => {
        if (element !== container && element.matches?.('button, a[href], input, select, textarea, [tabindex]') &&
            element.tabIndex >= 0 && !element.disabled && !element.hidden && !element.closest('[inert]') &&
            element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden') controls.push(element);
        // Theme dialogs often put their close control in a shadow root and chart
        // content in slots. Follow the composed tree rather than losing that control.
        let children = element.shadowRoot?.children || element.children || [];
        if (element.tagName === 'SLOT') {
          const assigned = element.assignedElements({ flatten: true });
          if (assigned.length) children = assigned;
        }
        [...children].forEach(visit);
      };
      visit(container);
      return controls;
    }

    focusSizeChart() {
      if (this.sizeChart && !this.sizeChart.contains(document.activeElement)) {
        (this.focusableElements(this.sizeChart)[0] || this.sizeChart).focus();
      }
    }

    async openModal(handle, trigger = document.activeElement) {
      if (this.overlay.classList.contains('cfp-active')) this.closeModal();
      this.nativeController?.abort();
      this.nativeAdapter?.close();
      this.nativeAdapter = null;
      window.CfpQuickViewAdapters?.closeOpenNative();
      const requestId = this.productRequestId = (this.productRequestId || 0) + 1;
      this.opener = trigger;
      this.selectedVariantId = null;
      this.selectedVariant = null;
      this.currentProduct = null;
      this.settings = { ...window.cfpGlobalSettings };
      // Native collection buttons must retain the collection configuration.
      window.CfpQuickViewAdapters?.configure(window.cfpGlobalSettings);
      if (trigger?.getAttribute('data-cfp-quick-view-context') === 'instant-search') {
        this.settings.quickViewStyle = this.settings.quickViewInstantSearchStyle ?? this.settings.quickViewStyle;
        this.settings.showQuickViewSizeChart = this.settings.showQuickViewInstantSearchSizeChart ?? this.settings.showQuickViewSizeChart;
      }
      const adapter = this.settings.quickViewStyle === 'theme'
        ? window.CfpQuickViewAdapters?.getQuickView({ theme: window.Shopify?.theme, settings: this.settings, trigger }) : null;
      if (adapter) {
        const controller = new AbortController();
        this.nativeController = controller;
        this.nativeAdapter = adapter;
        const timeout = setTimeout(() => controller.abort(), 10000);
        trigger?.setAttribute('aria-busy', 'true');
        trigger?.setAttribute('data-cfp-qv-request', String(requestId));
        try {
          if (await adapter.open({ handle, trigger, settings: this.settings, signal: controller.signal })) return;
        } catch {
          try { await adapter.close?.(); } catch { /* preserve app fallback */ }
        } finally {
          clearTimeout(timeout);
          if (this.nativeController === controller) this.nativeController = null;
          if (trigger?.getAttribute('data-cfp-qv-request') === String(requestId)) {
            trigger.removeAttribute('aria-busy');
            trigger.removeAttribute('data-cfp-qv-request');
          }
        }
        if (requestId !== this.productRequestId) return;
        this.nativeAdapter = null;
      }
      this.clearSizeChart();
      this.modal.innerHTML = `
        <button type="button" class="cfp-quick-view-close" aria-label="Close">&times;</button>
        <div class="cfp-quick-view-image-container cfp-qv-skeleton-bg" style="min-height: 100%; width: 50%;">&nbsp;</div>
        <div class="cfp-quick-view-details" style="width: 50%;">
          <div class="cfp-qv-skeleton-text" style="height: 32px; width: 80%; margin-bottom: 15px;">&nbsp;</div>
          <div class="cfp-qv-skeleton-text" style="height: 24px; width: 40%; margin-bottom: 25px;">&nbsp;</div>
          <div class="cfp-qv-skeleton-text" style="height: 16px; width: 100%; margin-bottom: 8px;">&nbsp;</div>
          <div class="cfp-qv-skeleton-text" style="height: 16px; width: 90%; margin-bottom: 8px;">&nbsp;</div>
          <div class="cfp-qv-skeleton-text" style="height: 16px; width: 60%; margin-bottom: 25px;">&nbsp;</div>
          <div class="cfp-qv-skeleton-text" style="height: 44px; width: 100%; border-radius: 22px;">&nbsp;</div>
        </div>
      `;
      this.modal.querySelector('.cfp-quick-view-close').addEventListener('click', () => this.closeModal());
      this.overlay.classList.add('cfp-active');
      if (this.savedOverflow === undefined) this.savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      if (!this.backgroundElements) {
        this.backgroundElements = [...document.body.children].filter(element => element !== this.overlay && element !== this.lightbox)
          .map(element => [element, element.inert]);
        this.backgroundElements.forEach(([element]) => { element.inert = true; });
      }
      this.modal.focus();
      
      try {
        const product = await this.loadProduct(handle);
        if (requestId !== this.productRequestId) return;
        this.currentProduct = product;
        this.renderProductDetails(product);
        this.modal.querySelector('.cfp-quick-view-close').focus();
      } catch (error) {
        if (requestId !== this.productRequestId) return;
        console.error('Error fetching product for quick view:', error);
        this.modal.innerHTML = '<button type="button" class="cfp-quick-view-close" aria-label="Close">&times;</button><div role="alert">Unable to load this product. <button type="button" class="cfp-qv-retry">Try again</button></div>';
        this.modal.querySelector('.cfp-quick-view-close').addEventListener('click', () => this.closeModal());
        this.modal.querySelector('.cfp-qv-retry').addEventListener('click', () => this.openModal(handle, this.opener));
        this.modal.querySelector('.cfp-quick-view-close').focus();
      }
    }

    async loadProduct(handle) {
      const url = `${window.Shopify?.routes?.root || '/'}products/${encodeURIComponent(handle)}.js`;
      // Coalesce in-flight requests only; reopening obtains fresh market/inventory data.
      if (!this.productRequests.has(url)) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const request = fetch(url, { signal: controller.signal, credentials: 'same-origin' })
          .then(response => {
            if (!response.ok) throw new Error('Product not found');
            return response.json();
          }).finally(() => { clearTimeout(timeout); this.productRequests.delete(url); });
        this.productRequests.set(url, request);
      }
      return this.productRequests.get(url);
    }

    money(cents) {
      const currency = window.Shopify?.currency?.active || window.cfpCurrencyCode;
      if (currency) {
        try { return new Intl.NumberFormat(document.documentElement.lang || undefined, { style: 'currency', currency }).format(cents / 100); } catch { /* use store symbol */ }
      }
      return `${window.cfpCurrencySymbol || '$'}${(cents / 100).toFixed(2)}`;
    }

    renderProductDetails(product) {
      const formattedPrice = (product.price / 100).toFixed(2);
      const comparePrice = product.compare_at_price ? (product.compare_at_price / 100).toFixed(2) : null;
      const allImages = product.images && product.images.length > 0 ? product.images : (product.featured_image ? [product.featured_image] : []);

      // Smart image ordering: put initial-variant image first so it's always visible in capped set
      const MAX_IMAGES = 8;
      let images = allImages;
      const initialVariantForImages = product.variants && product.variants.length > 0
        ? (product.variants.find(v => v.available) || product.variants[0])
        : null;
      if (initialVariantForImages && initialVariantForImages.featured_image) {
        const heroSrc = initialVariantForImages.featured_image.src.split('?')[0];
        const heroIdx = allImages.findIndex(img => img.split('?')[0] === heroSrc);
        if (heroIdx > 0) {
          // Move hero image to front so it shows first in the capped carousel
          const reordered = [allImages[heroIdx], ...allImages.slice(0, heroIdx), ...allImages.slice(heroIdx + 1)];
          images = reordered.slice(0, MAX_IMAGES);
        } else {
          images = allImages.slice(0, MAX_IMAGES);
        }
      } else {
        images = allImages.slice(0, MAX_IMAGES);
      }
      // Store on instance so updateVariantDetails can search the same capped set
      this.carouselImages = images;
      
      let imagesHtml = '';
      let dotsHtml = '';
      if (images.length > 0) {
        imagesHtml = images.map((img, index) => `<img src="${this.escape(img)}" alt="${this.escape(product.title)}" ${index ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async">`).join('');
        if (images.length > 1) {
          dotsHtml = `
            <div class="cfp-qv-carousel-dots">
              ${images.map((_, i) => `<button type="button" aria-label="Image ${i + 1}" class="cfp-qv-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></button>`).join('')}
            </div>
          `;
        }
      } else {
        imagesHtml = '<div style="padding: 50px;">No Image</div>';
      }

      // Determine initial variant (first available, fallback to first)
      let initialVariant = null;
      if (product.variants && product.variants.length > 0) {
        initialVariant = product.variants.find(v => v.available) || product.variants[0];
      }
      const initialVariantId = initialVariant ? initialVariant.id.toString().replace('gid://shopify/ProductVariant/', '') : '';
      this.selectedOptions = initialVariant ? [...initialVariant.options] : [];
      const initialVariantUrl = this.productUrl(product, initialVariantId);

      let optionsHtml = '';
      if (product.options && product.options.length > 0) {
        let defaultSelectedOptions = [];
        if (initialVariant) {
          defaultSelectedOptions = initialVariant.options;
        }

        product.options.forEach(option => {
          if (option.name === 'Title' && option.values.length === 1 && option.values[0] === 'Default Title') return;
          
          const isColor = option.name.toLowerCase().includes('color') || option.name.toLowerCase().includes('colour');
          
          // Hide non-color options (like Size) if B2B is enabled and customer is not logged in
          if (window.cfpGlobalSettings && window.cfpGlobalSettings.isWholesale && !window.cfpCustomerLoggedIn && !isColor) {
            return;
          }
          const optionPositionIdx = option.position - 1;
          const selectedValueForOption = defaultSelectedOptions[optionPositionIdx] || option.values[0];
          
          let valuesHtml = '';
          option.values.forEach((value) => {
            const isActive = (value === selectedValueForOption);
            let swatchImage = '';
            if (isColor && product.variants) {
              const matchingVariant = product.variants.find(v => v.options.includes(value) && v.featured_image);
              if (matchingVariant && matchingVariant.featured_image) {
                swatchImage = matchingVariant.featured_image.src;
              }
            }
            
            if (isColor && swatchImage) {
              valuesHtml += `
                <button type="button" aria-pressed="${isActive}" aria-label="${this.escape(value)}" class="cfp-qv-swatch-color ${isActive ? 'active' : ''}" data-option="${option.position}" data-value="${this.escape(value)}">
                  <img src="${this.escape(swatchImage)}" alt="" loading="lazy">
                </button>
              `;
            } else {
              valuesHtml += `
                <button type="button" aria-pressed="${isActive}" class="cfp-qv-swatch-box ${isActive ? 'active' : ''}" data-option="${option.position}" data-value="${this.escape(value)}">
                  ${this.escape(value)}
                </button>
              `;
            }
          });

          optionsHtml += `
            <div class="cfp-qv-option-group" role="group" aria-label="${this.escape(option.name)}">
              <div class="cfp-qv-option-header">
                <span class="cfp-qv-option-name">${this.escape(option.name)}: <span class="cfp-qv-option-selected">${this.escape(selectedValueForOption)}</span></span>
              </div>
              <div class="cfp-qv-option-values">
                ${valuesHtml}
              </div>
            </div>
          `;
        });
      }

      const vendorHtml = product.vendor ? `<span class="cfp-qv-vendor">${this.escape(product.vendor)}</span>` : '';
      const skuHtml = '<span class="cfp-qv-sku"></span>';

      const zoomIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>`;

      this.modal.innerHTML = `
        <button class="cfp-quick-view-close" aria-label="Close">&times;</button>
        <div class="cfp-quick-view-image-container">
          <div class="cfp-qv-carousel">
            <div class="cfp-qv-carousel-track">
              ${imagesHtml}
            </div>
            ${images.length > 0 ? `<button class="cfp-qv-zoom-btn" aria-label="Zoom">${zoomIcon}</button>` : ''}
          </div>
          ${dotsHtml}
        </div>
        <div class="cfp-quick-view-details">
          <h2 class="cfp-quick-view-title">${this.escape(product.title)}</h2>
          <div class="cfp-qv-vendor-row">
            ${vendorHtml}
            ${skuHtml}
          </div>
          ${(window.cfpGlobalSettings && window.cfpGlobalSettings.isWholesale && !window.cfpCustomerLoggedIn) ? '' : `
          <div class="cfp-qv-price-row">
            <span class="cfp-qv-price">${window.cfpCurrencySymbol || '$'}${formattedPrice}</span>
            <span class="cfp-qv-compare-price" style="display: ${comparePrice && parseFloat(comparePrice) > parseFloat(formattedPrice) ? 'inline-block' : 'none'};">${window.cfpCurrencySymbol || '$'}${comparePrice}</span>
          </div>
          `}
          
          <div class="cfp-qv-options">
            ${optionsHtml}
          </div>
          <button type="button" hidden class="cfp-qv-size-chart" aria-haspopup="dialog" aria-expanded="false">Size chart</button>
          <p class="cfp-qv-cart-status" role="status" aria-live="polite"></p>

          ${(window.cfpGlobalSettings && window.cfpGlobalSettings.isWholesale && !window.cfpCustomerLoggedIn) 
             ? `<a class="cfp-qv-login-btn" href="${window.Shopify?.routes?.root || '/'}account/login">Login to add to cart</a>`
             : `<button class="cfp-qv-add-to-cart-btn">ADD TO CART</button>`}
          
          <div class="cfp-qv-view-details-row">
            <a href="${this.escape(initialVariantUrl)}" class="cfp-qv-view-details-link" id="cfp-qv-view-details-anchor">View details</a>
          </div>
        </div>
      `;

      const closeBtn = this.modal.querySelector('.cfp-quick-view-close');
      closeBtn.addEventListener('click', () => this.closeModal());
      this.modal.querySelector('.cfp-qv-add-to-cart-btn')?.addEventListener('click', () => this.addToCart());
      this.modal.querySelectorAll('.cfp-qv-size-chart').forEach(trigger => {
        trigger.addEventListener('click', event => {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.openSizeChart(product, trigger);
        });
      });

      // Carousel Logic
      let currentImageIndex = 0;
      let goToSlide = null;
      if (images.length > 0) {
        const track = this.modal.querySelector('.cfp-qv-carousel-track');
        const dots = this.modal.querySelectorAll('.cfp-qv-dot');
        
        goToSlide = (index) => {
          currentImageIndex = index;
          track.style.transform = `translateX(-${index * 100}%)`;
          dots.forEach(d => d.classList.remove('active'));
          if (dots[index]) dots[index].classList.add('active');
        };

        dots.forEach((dot, index) => {
          dot.addEventListener('click', () => {
            goToSlide(index);
          });
        });
      }

      // Zoom Logic
      const zoomBtn = this.modal.querySelector('.cfp-qv-zoom-btn');
      if (zoomBtn) {
        zoomBtn.addEventListener('click', () => {
          this.openLightbox(images, currentImageIndex);
        });
      }

      // Variant Selection Logic
      const optionGroups = this.modal.querySelectorAll('.cfp-qv-option-group');
      optionGroups.forEach(group => {
        const swatches = group.querySelectorAll('.cfp-qv-swatch-color, .cfp-qv-swatch-box');
        const selectedLabel = group.querySelector('.cfp-qv-option-selected');
        
        swatches.forEach(swatch => {
          swatch.addEventListener('click', () => {
            if (swatch.classList.contains('active')) return;
            
            swatches.forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
            
            const value = swatch.getAttribute('data-value');
            this.selectedOptions[Number(swatch.getAttribute('data-option')) - 1] = value;
            if (selectedLabel) selectedLabel.textContent = value;
            
            this.updateVariantDetails(product, goToSlide);
          });
        });
      });
      
      // Initialize first variant
      this.updateVariantDetails(product, goToSlide);
    }

    escape(value) {
      return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    }

    productUrl(product, variantId) {
      const url = new URL(`${window.Shopify?.routes?.root || '/'}products/${encodeURIComponent(product.handle)}`, location.origin);
      if (variantId) url.searchParams.set('variant', variantId);
      return url.href;
    }

    updateVariantDetails(product, goToSlide) {
      if (!product.variants || product.variants.length === 0) return;
      
      const selectedOptions = this.selectedOptions || [];
      const activeSwatches = this.modal.querySelectorAll('.cfp-qv-swatch-color.active, .cfp-qv-swatch-box.active');
      activeSwatches.forEach(swatch => {
        const position = parseInt(swatch.getAttribute('data-option'), 10);
        selectedOptions[position - 1] = swatch.getAttribute('data-value');
      });

      const matchingVariant = product.variants.find(variant => {
        return variant.options.every((opt, index) => opt === selectedOptions[index]);
      });
      this.selectedVariantId = matchingVariant?.id || null;
      this.selectedVariant = matchingVariant || null;
      this.goToSlide = goToSlide;
      this.modal.querySelectorAll('.cfp-qv-swatch-color, .cfp-qv-swatch-box').forEach(swatch => {
        swatch.setAttribute('aria-pressed', String(swatch.classList.contains('active')));
      });

      if (matchingVariant) {
        // Update Price
        const priceEl = this.modal.querySelector('.cfp-qv-price');
        if (priceEl) priceEl.textContent = this.money(matchingVariant.price);
        
        const comparePriceEl = this.modal.querySelector('.cfp-qv-compare-price');
        if (comparePriceEl) {
          if (matchingVariant.compare_at_price && matchingVariant.compare_at_price > matchingVariant.price) {
            comparePriceEl.textContent = this.money(matchingVariant.compare_at_price);
            comparePriceEl.style.display = 'inline-block';
          } else {
            comparePriceEl.style.display = 'none';
          }
        }

        // Update SKU
        const skuEl = this.modal.querySelector('.cfp-qv-sku');
        if (skuEl) {
          const fullSku = matchingVariant.sku || '';
          skuEl.textContent = fullSku;
        }

        // Update Image — search within the CAPPED carousel images, not the full product.images array
        // Using full array index with a capped carousel causes translate to fly off-screen (blank white)
        const variantImage = matchingVariant.featured_image?.src || product.featured_image || product.images?.[0];
        if (variantImage && goToSlide) {
          const featuredSrc = variantImage.split('?')[0];
          const carouselImgs = this.carouselImages || [];
          let imgIndex = carouselImgs.findIndex(img => img.split('?')[0] === featuredSrc);

          if (imgIndex === -1) {
            // Replace one gallery slot with the actual selected variant image.
            imgIndex = 0;
            carouselImgs[0] = variantImage;
            this.modal.querySelector('.cfp-qv-carousel-track img').src = variantImage;
          }

          // Final clamp: never go out of bounds
          if (imgIndex < 0 || imgIndex >= carouselImgs.length) imgIndex = 0;
          goToSlide(imgIndex);
        }
        
        // Update Add to Cart Button state
        this.updateCartButton();

        this.selectedVariantId = matchingVariant.id;

        // Fix: update View Details link so PDP opens the selected variant
        const viewDetailsLink = this.modal.querySelector('#cfp-qv-view-details-anchor');
        if (viewDetailsLink && product.url) {
          const cleanVariantId = matchingVariant.id.toString().replace('gid://shopify/ProductVariant/', '');
          viewDetailsLink.href = this.productUrl(product, cleanVariantId);
        }
      } else {
        // If variant doesn't exist
        const addToCartBtn = this.modal.querySelector('.cfp-qv-add-to-cart-btn');
        if (addToCartBtn) {
          addToCartBtn.textContent = 'UNAVAILABLE';
          addToCartBtn.classList.add('sold-out');
          addToCartBtn.disabled = true;
        }
        const price = this.modal.querySelector('.cfp-qv-price');
        if (price) price.textContent = 'Unavailable';
        const compare = this.modal.querySelector('.cfp-qv-compare-price');
        if (compare) compare.style.display = 'none';
        const sku = this.modal.querySelector('.cfp-qv-sku');
        if (sku) sku.textContent = '';
        const details = this.modal.querySelector('#cfp-qv-view-details-anchor');
        if (details) details.href = this.productUrl(product);
      }

      // Update sold-out styling for all swatches
      const optionGroups = this.modal.querySelectorAll('.cfp-qv-option-group');
      optionGroups.forEach(group => {
        const swatches = group.querySelectorAll('.cfp-qv-swatch-color, .cfp-qv-swatch-box');
        swatches.forEach(swatch => {
          const position = parseInt(swatch.getAttribute('data-option'), 10);
          const value = swatch.getAttribute('data-value');
          
          const testOptions = [...selectedOptions];
          testOptions[position - 1] = value;
          
          const testVariant = product.variants.find(variant => {
            return variant.options.every((opt, index) => opt === testOptions[index]);
          });
          swatch.setAttribute('aria-label', `${value}${!testVariant ? ' (unavailable combination)' : !testVariant.available ? ' (sold out)' : ''}`);
          
          if (!testVariant || !testVariant.available) {
            swatch.classList.add('sold-out');
          } else {
            swatch.classList.remove('sold-out');
          }
        });
      });
      this.clearSizeChart();
      const chartTrigger = this.modal.querySelector('.cfp-qv-size-chart');
      if (chartTrigger) {
        chartTrigger.hidden = true;
        if (this.settings?.showQuickViewSizeChart === true && matchingVariant) this.openSizeChart(product, chartTrigger, true);
      }
    }

    async openSizeChart(product, trigger, prepareOnly = false) {
      if (this.settings?.showQuickViewSizeChart !== true || !window.CfpQuickViewAdapters?.supportsSizeChart()) return;
      if (this.sizeChartRequest) return;
      if (this.sizeChart) {
        if (!prepareOnly) {
          try {
            trigger.setAttribute('aria-expanded', 'true');
            await this.sizeChart.show();
            this.focusSizeChart();
          } catch {
            this.clearSizeChart();
            trigger.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
          }
        }
        return;
      }

      const controller = new AbortController();
      this.sizeChartRequest = controller;
      const timeout = setTimeout(() => controller.abort(), 15000);
      trigger.disabled = true;
      trigger.setAttribute('aria-busy', 'true');
      this.modal.querySelector('.cfp-qv-chart-status')?.remove();
      const root = window.Shopify?.routes?.root || '/';
      const productUrl = new URL(`${root}products/${encodeURIComponent(product.handle)}`, location.origin);
      if (this.selectedVariantId) productUrl.searchParams.set('variant', this.selectedVariantId);
      // Keep requests in the unpublished theme when testing a theme preview.
      if (window.Shopify?.theme?.role === 'unpublished') {
        productUrl.searchParams.set('preview_theme_id', window.Shopify.theme.id);
      }

      try {
        const key = productUrl.href;
        const cached = this.chartCache.get(key);
        let html;
        if (cached && Date.now() - cached.at < 30000) html = cached.html;
        else {
          const response = await fetch(productUrl, { signal: controller.signal, credentials: 'same-origin' });
          if (!response.ok) throw new Error('Unable to load the product size chart');
          html = await response.text();
          if (this.chartCache.size >= 20) this.chartCache.delete(this.chartCache.keys().next().value);
        }
        if (controller !== this.sizeChartRequest) return;
        const page = new DOMParser().parseFromString(html, 'text/html');
        const source = window.CfpQuickViewAdapters.getSizeChart(page);
        this.chartCache.set(key, { html: source?.outerHTML || '', at: Date.now() });
        if (!source) {
          throw new Error('No compatible product size chart found');
        }

        // Import only the chart, never the product page's scripts or other dialogs.
        const chart = document.importNode(source, true);
        chart.querySelectorAll('script').forEach(script => script.remove());
        [chart, ...chart.querySelectorAll('*')].forEach(element => {
          [...element.attributes].forEach(attribute => {
            if (/^on/i.test(attribute.name) || (['href', 'src'].includes(attribute.name) && /^\s*javascript:/i.test(attribute.value))) element.removeAttribute(attribute.name);
          });
        });
        chart.removeAttribute('open');
        const ids = new Map();
        [chart, ...chart.querySelectorAll('[id]')].forEach(element => {
          if (!element.id) return;
          const id = `cfp-qv-${element.id}`;
          ids.set(element.id, id);
          element.id = id;
        });
        [chart, ...chart.querySelectorAll('*')].forEach(element => {
          ['aria-controls', 'aria-labelledby', 'aria-describedby', 'for'].forEach(attribute => {
            if (!element.hasAttribute(attribute)) return;
            element.setAttribute(attribute, element.getAttribute(attribute).split(' ').map(id => ids.get(id) || id).join(' '));
          });
        });
        chart.classList.add('cfp-qv-chart-modal');
        chart.setAttribute('role', 'dialog');
        chart.setAttribute('aria-modal', 'true');
        chart.setAttribute('aria-label', 'Size chart');
        chart.tabIndex = -1;
        chart.style.setProperty('z-index', '2147483647', 'important');
        this.bindSizeChartControls(chart);
        chart.addEventListener('dialog:before-show', () => { this.overlay.inert = true; });
        chart.addEventListener('dialog:after-hide', () => {
          this.overlay.inert = Boolean(this.sizeChart?.open);
          trigger.setAttribute('aria-expanded', 'false');
          if (!this.overlay.inert && trigger.isConnected && this.overlay.classList.contains('cfp-active')) trigger.focus();
        });
        this.sizeChart = chart;
        if (!chart.id) chart.id = 'cfp-qv-size-chart';
        trigger.setAttribute('aria-controls', chart.id);
        trigger.setAttribute('aria-expanded', 'false');
        document.body.appendChild(chart);
        trigger.hidden = false;
        if (!prepareOnly) {
          trigger.setAttribute('aria-expanded', 'true');
          await chart.show();
          this.focusSizeChart();
        }
      } catch (error) {
        // Closing quick view or switching products cancels the request silently.
        if (controller !== this.sizeChartRequest) return;
        this.clearSizeChart();
        trigger.setAttribute('aria-expanded', 'false');
        trigger.removeAttribute('aria-controls');
        trigger.hidden = true;
      } finally {
        clearTimeout(timeout);
        if (this.sizeChartRequest === controller) this.sizeChartRequest = null;
        trigger.disabled = false;
        trigger.removeAttribute('aria-busy');
      }
    }

    bindSizeChartControls(chart) {
      // Scope controls to this chart; theme scripts may initialize only on page load
      // or use document-wide tab selectors that would affect other product dialogs.
      chart.querySelectorAll('.sc-units .unit, .sc-tab').forEach(control => {
        control.setAttribute('role', 'button');
        control.tabIndex = 0;
        control.setAttribute('aria-pressed', String(control.classList.contains('active')));
      });
      chart.addEventListener('keydown', event => {
        if (['Enter', ' '].includes(event.key) && event.target.matches('.sc-units .unit, .sc-tab')) {
          event.preventDefault();
          event.target.click();
        }
      });
      chart.addEventListener('click', event => {
        const control = event.target.closest('.sc-units .unit, .sc-tab');
        if (!control) return;
        event.preventDefault();
        event.stopPropagation();
        const wrap = control.closest('.sc-wrap') || chart;
        const isUnit = control.matches('.unit');
        wrap.querySelectorAll(isUnit ? '.sc-units .unit' : '.sc-tab').forEach(item => {
          item.classList.toggle('active', item === control);
          item.setAttribute('aria-pressed', String(item === control));
        });
        if (isUnit) {
          if (!['in', 'cm'].includes(control.dataset.unit)) return;
          wrap.querySelectorAll('.sc-dynamic-table td[data-cm][data-in]').forEach(cell => {
            cell.textContent = cell.dataset[control.dataset.unit];
          });
        } else {
          wrap.querySelectorAll('.sc-tab-content').forEach(panel => {
            panel.classList.toggle('active', panel.dataset.tabContent === control.dataset.tab);
          });
        }
      });
    }

    clearSizeChart() {
      this.sizeChartRequest?.abort();
      this.sizeChartRequest = null;
      const chart = this.sizeChart;
      this.sizeChart = null;
      this.overlay.inert = false;
      if (chart) {
        // Let the theme release its focus trap and scroll lock before removing it.
        if (chart.open) Promise.resolve(chart.hide()).catch(() => {}).finally(() => chart.remove());
        else chart.remove();
      }
    }

    closeModal() {
      this.productRequestId = (this.productRequestId || 0) + 1;
      this.nativeController?.abort();
      this.nativeController = null;
      this.nativeAdapter?.close();
      this.nativeAdapter = null;
      this.clearSizeChart();
      this.overlay.classList.remove('cfp-active');
      this.lightbox.classList.remove('cfp-active');
      this.modal.inert = false;
      if (this.savedOverflow !== undefined) {
        document.body.style.overflow = this.savedOverflow;
        this.savedOverflow = undefined;
      }
      this.backgroundElements?.forEach(([element, inert]) => { element.inert = inert; });
      this.backgroundElements = null;
      if (this.opener?.isConnected) this.opener.focus();
    }

    updateCartButton() {
      const btn = this.modal.querySelector('.cfp-qv-add-to-cart-btn');
      if (!btn) return;
      const available = Boolean(this.selectedVariant?.available);
      btn.textContent = this.cartPending ? 'ADDING...' : !this.selectedVariant ? 'UNAVAILABLE' : available ? 'ADD TO CART' : 'SOLD OUT';
      btn.disabled = this.cartPending || !available;
      btn.classList.toggle('sold-out', !available);
      this.modal.querySelectorAll('.cfp-qv-swatch-color, .cfp-qv-swatch-box').forEach(swatch => { swatch.disabled = this.cartPending; });
    }

    async addToCart() {
      if (this.cartPending || !this.selectedVariantId || !this.selectedVariant?.available) return;
      const variantId = this.selectedVariantId;
      const requestId = this.productRequestId;
      const product = this.currentProduct;
      const opener = this.opener;
      const status = this.modal.querySelector('.cfp-qv-cart-status');
      if (status) status.textContent = '';
      this.cartPending = true;
      this.updateCartButton();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const rootUrl = window.Shopify?.routes?.root || '/';
      let added = false;
      try {
        const response = await fetch(`${rootUrl}cart/add.js`, {
          method: 'POST',
          signal: controller.signal,
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            items: [{ id: variantId, quantity: 1 }],
            sections: window.CfpQuickViewAdapters?.getCartSections() || ['cart-drawer', 'cart-icon-bubble'],
            sections_url: window.location.pathname,
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data || data.status >= 400) {
          throw new Error(data?.description || data?.message || 'Unable to add this item. Please try again.');
        }
        added = true;
        // A completed older request must not close a newer product dialog.
        if (requestId !== this.productRequestId) return;
        if (status) status.textContent = 'Added to cart.';
        // Theme rendering is separate from purchase success: never invite a duplicate
        // purchase because a theme drawer failed after Shopify accepted the item.
        this.closeModal();
        const closedRequestId = this.productRequestId;
        try {
          if (window.CfpQuickViewAdapters?.renderCart(data, opener)) return;
          window.CfpQuickViewAdapters?.notifyCartAdded(data);
          await new Promise(resolve => setTimeout(resolve, 500));
          if (closedRequestId !== this.productRequestId || window.CfpQuickViewAdapters?.isCartOpen()) return;
        } catch { /* fall through to the actual cart */ }
        window.location.href = `${rootUrl}cart`;
      } catch (error) {
        if (requestId === this.productRequestId && status) {
          status.textContent = error.name === 'AbortError'
            ? 'The request timed out. Check your cart before trying again; the item may have been added.'
            : error.message || 'Unable to add this item. Please try again.';
        }
      } finally {
        clearTimeout(timeout);
        this.cartPending = false;
        this.updateCartButton();
        if (added && product) this.chartCache.clear();
      }
    }

  };

  // Initialize on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!window.cfpQuickViewInstance) {
        window.cfpQuickViewInstance = new window.CfpQuickView();
      }
    });
  } else {
    if (!window.cfpQuickViewInstance) {
      window.cfpQuickViewInstance = new window.CfpQuickView();
    }
  }
}
