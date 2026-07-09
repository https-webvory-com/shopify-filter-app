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

      const zoomIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>`;

      this.modal.innerHTML = `
        <button class="cfp-quick-view-close" aria-label="Close">&times;</button>
        <div class="cfp-quick-view-image-container">
          <div class="cfp-qv-carousel">
            <div class="cfp-qv-carousel-track">
              ${imagesHtml}
            </div>
            ${images.length > 0 ? `<button class="cfp-qv-zoom-btn" aria-label="Zoom">${zoomIcon}</button>` : ''}
            ${dotsHtml}
          </div>
        </div>
        <div class="cfp-quick-view-details">
          <h2 class="cfp-quick-view-title">${product.title}</h2>
          <div class="cfp-quick-view-price">${window.cfpCurrencySymbol || '$'}${formattedPrice}</div>
          <div class="cfp-quick-view-description">
            <p>Product details logged to console. Base UI ready.</p>
          </div>
        </div>
      `;

      const closeBtn = this.modal.querySelector('.cfp-quick-view-close');
      closeBtn.addEventListener('click', () => this.closeModal());

      // Carousel Logic
      let currentImageIndex = 0;
      if (images.length > 1) {
        const track = this.modal.querySelector('.cfp-qv-carousel-track');
        const dots = this.modal.querySelectorAll('.cfp-qv-dot');
        
        const goToSlide = (index) => {
          currentImageIndex = index;
          track.style.transform = `translateX(-${index * 100}%)`;
          dots.forEach(d => d.classList.remove('active'));
          if (dots[index]) dots[index].classList.add('active');
        };

        // Autoplay setup
        const startAutoplay = () => {
          this.carouselAutoplayInterval = setInterval(() => {
            let nextIndex = currentImageIndex + 1;
            if (nextIndex >= images.length) nextIndex = 0;
            goToSlide(nextIndex);
          }, 3000);
        };

        const resetAutoplay = () => {
          if (this.carouselAutoplayInterval) clearInterval(this.carouselAutoplayInterval);
          startAutoplay();
        };

        dots.forEach((dot, index) => {
          dot.addEventListener('click', () => {
            goToSlide(index);
            resetAutoplay();
          });
        });

        // Start autoplay
        if (this.carouselAutoplayInterval) clearInterval(this.carouselAutoplayInterval);
        startAutoplay();
      }

      // Zoom Logic
      const zoomBtn = this.modal.querySelector('.cfp-qv-zoom-btn');
      if (zoomBtn) {
        zoomBtn.addEventListener('click', () => {
          this.openLightbox(images, currentImageIndex);
        });
      }
    }

    closeModal() {
      if (this.carouselAutoplayInterval) clearInterval(this.carouselAutoplayInterval);
      this.overlay.classList.remove('cfp-active');
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
