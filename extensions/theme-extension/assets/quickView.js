if (typeof window.CfpQuickView === 'undefined') {
  window.CfpQuickView = class CfpQuickView {
    constructor() {
      this.modal = null;
      this.overlay = null;
      this.init();
    }

    init() {
      this.createModalDOM();
      this.attachEventListeners();
    }

    createModalDOM() {
      // Create overlay
      this.overlay = document.createElement('div');
      this.overlay.className = 'cfp-quick-view-overlay';
      
      // Create modal
      this.modal = document.createElement('div');
      this.modal.className = 'cfp-quick-view-modal';
      
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
        this.lightbox.classList.remove('cfp-active');
      });
      this.lightbox.querySelector('#cfp-lightbox-prev').addEventListener('click', () => this.navigateLightbox(-1));
      this.lightbox.querySelector('#cfp-lightbox-next').addEventListener('click', () => this.navigateLightbox(1));
      
      this.currentLightboxImages = [];
      this.currentLightboxIndex = 0;
    }

    openLightbox(images, startIndex) {
      this.currentLightboxImages = images;
      this.currentLightboxIndex = startIndex;
      this.updateLightboxImage();
      this.lightbox.classList.add('cfp-active');
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
      // Use event delegation for dynamically loaded product cards
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('.cfp-quick-view-btn');
        if (btn) {
          e.preventDefault();
          e.stopPropagation();
          const handle = btn.getAttribute('data-product-handle');
          if (handle) {
            this.openModal(handle);
          }
        }
      });
    }

    async openModal(handle) {
      this.modal.innerHTML = `
        <button class="cfp-quick-view-close" aria-label="Close" onclick="window.cfpQuickViewInstance.closeModal()">&times;</button>
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
      this.overlay.classList.add('cfp-active');
      
      try {
        const response = await fetch(`/products/${handle}.js`);
        if (!response.ok) throw new Error('Product not found');
        
        const product = await response.json();
        console.log('--- QUICK VIEW PRODUCT DETAILS ---');
        console.log(product);
        console.log('----------------------------------');
        
        this.renderProductDetails(product);
      } catch (error) {
        console.error('Error fetching product for quick view:', error);
        this.modal.innerHTML = '<div style="padding: 40px; text-align: center; color: red;">Error loading product details.</div>';
      }
    }

    renderProductDetails(product) {
      const formattedPrice = (product.price / 100).toFixed(2);
      const comparePrice = product.compare_at_price ? (product.compare_at_price / 100).toFixed(2) : null;
      const images = product.images && product.images.length > 0 ? product.images : (product.featured_image ? [product.featured_image] : []);
      
      let imagesHtml = '';
      let dotsHtml = '';
      if (images.length > 0) {
        imagesHtml = images.map(img => `<img src="${img}" alt="${product.title}">`).join('');
        if (images.length > 1) {
          dotsHtml = `
            <div class="cfp-qv-carousel-dots">
              ${images.map((_, i) => `<span class="cfp-qv-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></span>`).join('')}
            </div>
          `;
        }
      } else {
        imagesHtml = '<div style="padding: 50px;">No Image</div>';
      }

      let optionsHtml = '';
      if (product.options && product.options.length > 0) {
        let defaultSelectedOptions = [];
        if (product.variants && product.variants.length > 0) {
          const firstAvailable = product.variants.find(v => v.available);
          if (firstAvailable) {
            defaultSelectedOptions = firstAvailable.options;
          } else {
            defaultSelectedOptions = product.variants[0].options;
          }
        }

        product.options.forEach(option => {
          if (option.name === 'Title' && option.values.length === 1 && option.values[0] === 'Default Title') return;
          
          const isColor = option.name.toLowerCase().includes('color') || option.name.toLowerCase().includes('colour');
          const optionPositionIdx = option.position - 1;
          const selectedValueForOption = defaultSelectedOptions[optionPositionIdx] || option.values[0];
          
          let valuesHtml = '';
          option.values.forEach((value, index) => {
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
                <div class="cfp-qv-swatch-color ${isActive ? 'active' : ''}" data-option="${option.position}" data-value="${value.replace(/"/g, '&quot;')}">
                  <img src="${swatchImage}" alt="${value}">
                </div>
              `;
            } else {
              valuesHtml += `
                <div class="cfp-qv-swatch-box ${isActive ? 'active' : ''}" data-option="${option.position}" data-value="${value.replace(/"/g, '&quot;')}">
                  ${value}
                </div>
              `;
            }
          });

          optionsHtml += `
            <div class="cfp-qv-option-group">
              <div class="cfp-qv-option-header">
                <span class="cfp-qv-option-name">${option.name}: <span class="cfp-qv-option-selected">${selectedValueForOption}</span></span>
                ${option.name.toLowerCase().includes('size') ? `<a href="#" class="cfp-qv-size-chart"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 12v-2M12 12v-2M16 12v-2"></path></svg> Size chart</a>` : ''}
              </div>
              <div class="cfp-qv-option-values">
                ${valuesHtml}
              </div>
            </div>
          `;
        });
      }

      const vendorHtml = product.vendor ? `<span class="cfp-qv-vendor">${product.vendor}</span>` : '';
      const skuHtml = (product.variants && product.variants[0] && product.variants[0].sku) ? `<span class="cfp-qv-sku">${product.variants[0].sku.split('-')[0]}</span>` : '';

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
          <h2 class="cfp-quick-view-title">${product.title}</h2>
          <div class="cfp-qv-vendor-row">
            ${vendorHtml}
            ${skuHtml}
          </div>
          <div class="cfp-qv-price-row">
            <span class="cfp-qv-price">${window.cfpCurrencySymbol || '$'}${formattedPrice}</span>
            <span class="cfp-qv-compare-price" style="display: ${comparePrice && parseFloat(comparePrice) > parseFloat(formattedPrice) ? 'inline-block' : 'none'};">${window.cfpCurrencySymbol || '$'}${comparePrice}</span>
          </div>
          
          <div class="cfp-qv-options">
            ${optionsHtml}
          </div>

          <button class="cfp-qv-add-to-cart-btn">ADD TO CART</button>
          
          <div class="cfp-qv-view-details-row">
            <a href="${product.url}" class="cfp-qv-view-details-link">View details</a>
          </div>
        </div>
      `;

      const closeBtn = this.modal.querySelector('.cfp-quick-view-close');
      closeBtn.addEventListener('click', () => this.closeModal());

      // Carousel Logic
      let currentImageIndex = 0;
      let goToSlide = null;
      if (images.length > 1) {
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
            if (selectedLabel) selectedLabel.textContent = value;
            
            this.updateVariantDetails(product, goToSlide);
          });
        });
      });
      
      // Initialize first variant
      this.updateVariantDetails(product, goToSlide);
    }

    updateVariantDetails(product, goToSlide) {
      if (!product.variants || product.variants.length === 0) return;
      
      const selectedOptions = [];
      const activeSwatches = this.modal.querySelectorAll('.cfp-qv-swatch-color.active, .cfp-qv-swatch-box.active');
      activeSwatches.forEach(swatch => {
        const position = parseInt(swatch.getAttribute('data-option'), 10);
        selectedOptions[position - 1] = swatch.getAttribute('data-value');
      });

      const matchingVariant = product.variants.find(variant => {
        return variant.options.every((opt, index) => opt === selectedOptions[index]);
      });

      if (matchingVariant) {
        // Update Price
        const priceEl = this.modal.querySelector('.cfp-qv-price');
        if (priceEl) priceEl.textContent = `${window.cfpCurrencySymbol || '$'}${(matchingVariant.price / 100).toFixed(2)}`;
        
        const comparePriceEl = this.modal.querySelector('.cfp-qv-compare-price');
        if (comparePriceEl) {
          if (matchingVariant.compare_at_price && matchingVariant.compare_at_price > matchingVariant.price) {
            comparePriceEl.textContent = `${window.cfpCurrencySymbol || '$'}${(matchingVariant.compare_at_price / 100).toFixed(2)}`;
            comparePriceEl.style.display = 'inline-block';
          } else {
            comparePriceEl.style.display = 'none';
          }
        }

        // Update SKU
        const skuEl = this.modal.querySelector('.cfp-qv-sku');
        if (skuEl) {
          const fullSku = matchingVariant.sku || '';
          skuEl.textContent = fullSku ? fullSku.split('-')[0] : '';
        }

        // Update Image
        if (matchingVariant.featured_image && goToSlide) {
          let imgIndex = -1;
          if (matchingVariant.featured_image.position) {
            imgIndex = matchingVariant.featured_image.position - 1;
          } else if (product.images) {
            const featuredSrc = matchingVariant.featured_image.src.split('?')[0];
            imgIndex = product.images.findIndex(img => img.split('?')[0] === featuredSrc);
          }
          
          if (imgIndex !== -1) {
            goToSlide(imgIndex);
          }
        }
        
        // Update Add to Cart Button state
        const addToCartBtn = this.modal.querySelector('.cfp-qv-add-to-cart-btn');
        if (addToCartBtn) {
          const newBtn = addToCartBtn.cloneNode(true);
          addToCartBtn.parentNode.replaceChild(newBtn, addToCartBtn);
          
          if (matchingVariant.available) {
            newBtn.textContent = 'ADD TO CART';
            newBtn.classList.remove('sold-out');
            newBtn.disabled = false;
            newBtn.addEventListener('click', () => this.addToCart());
          } else {
            newBtn.textContent = 'SOLD OUT';
            newBtn.classList.add('sold-out');
            newBtn.disabled = true;
          }
        }

        this.selectedVariantId = matchingVariant.id;
      } else {
        // If variant doesn't exist
        const addToCartBtn = this.modal.querySelector('.cfp-qv-add-to-cart-btn');
        if (addToCartBtn) {
          addToCartBtn.textContent = 'UNAVAILABLE';
          addToCartBtn.classList.add('sold-out');
          addToCartBtn.disabled = true;
        }
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
          
          if (!testVariant || !testVariant.available) {
            swatch.classList.add('sold-out');
          } else {
            swatch.classList.remove('sold-out');
          }
        });
      });
    }

    closeModal() {
      this.overlay.classList.remove('cfp-active');
    }

    async addToCart() {
      if (!this.selectedVariantId) return;

      const btn = this.modal.querySelector('.cfp-qv-add-to-cart-btn');
      if (btn.classList.contains('sold-out')) return;

      const originalText = btn.textContent;
      btn.textContent = 'ADDING...';
      btn.disabled = true;

      const rootUrl = window.Shopify && window.Shopify.routes && window.Shopify.routes.root ? window.Shopify.routes.root : '/';
      
      try {
        const cartDrawer = document.querySelector('cart-drawer');
        let sectionsToRequest = 'cart-drawer,cart-icon-bubble';
        
        if (cartDrawer && typeof cartDrawer.getSectionsToRender === 'function') {
           try {
             const sections = cartDrawer.getSectionsToRender();
             sectionsToRequest = sections.map(s => s.id).join(',');
           } catch(e) {}
        }

        const response = await fetch(`${rootUrl}cart/add.js`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            items: [{
              id: this.selectedVariantId,
              quantity: 1
            }],
            sections: sectionsToRequest,
            sections_url: window.location.pathname
          })
        });

        const data = await response.json();
        
        if (data.status && data.status === 422) {
           btn.textContent = 'SOLD OUT';
           return;
        }

        btn.textContent = 'ADDED!';

        // Support for Dawn theme / OS 2.0 standard cart-drawer
        if (cartDrawer && data.sections) {
          if (typeof cartDrawer.renderContents === 'function') {
             if (typeof cartDrawer.setActiveElement === 'function') {
                 cartDrawer.setActiveElement(btn);
             }
             cartDrawer.classList.remove('is-empty');
             
             const drawerInner = cartDrawer.querySelector('.drawer__inner');
             if (drawerInner) drawerInner.classList.remove('is-empty');

             cartDrawer.renderContents(data);
             this.closeModal();
             return;
          }
        }

        // Dispatch events that other Shopify themes commonly listen to
        document.dispatchEvent(new CustomEvent('ajaxProduct:added', { detail: { product: data } }));
        document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart: data } }));
        window.dispatchEvent(new Event('cart:refresh'));
        window.dispatchEvent(new CustomEvent('cart:build', { bubbles: true }));

        // Fallback: wait a bit to see if any theme AJAX drawer opens
        setTimeout(() => {
          const hasOpenDrawer = document.querySelector('cart-drawer.is-active, cart-drawer.active, .drawer.active, .is-open, .cart-drawer--open, .cart-notification.active, #CartDrawer.active');
          if (hasOpenDrawer) {
            this.closeModal();
          } else {
             window.location.href = `${rootUrl}cart`;
            console.log('Redirect to cart page temporarily disabled for testing.');
          }
        }, 500);

      } catch (error) {
        console.error('Error adding to cart:', error);
        btn.textContent = 'ERROR';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 2000);
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
