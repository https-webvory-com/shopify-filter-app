/**
 * CFP UI Builder V2
 * Responsible for generating pure HTML strings based on data and settings.
 * No direct DOM manipulation happens here.
 */

window.CFP_V2 = window.CFP_V2 || {};

window.CFP_V2.UIBuilder = (function() {
  
  // Helper: CSS Color mapper
  const getColorHex = (colorName) => {
    const colors = {
      black: '#1a1a1a', white: '#ffffff', red: '#e63946', blue: '#4361ee',
      green: '#2a9d8f', yellow: '#e9c46a', orange: '#f4a261', pink: '#ffb5a7',
      grey: '#8d99ae', gray: '#8d99ae', purple: '#7209b7', brown: '#6c584c'
    };
    return colors[(colorName || "").toLowerCase()] || colorName;
  };

  const getCleanLabel = (type, val, advSetting) => {
    let cleanVal = val.toLowerCase().trim();
    let displayLabel = val;

    if (type === 'tag' || type === 'tags') {
      if (advSetting && advSetting.tagPrefix && advSetting.tagPrefix.trim() !== '') {
        const prefix = advSetting.tagPrefix.trim();
        if (val.toLowerCase().startsWith(prefix.toLowerCase())) {
          displayLabel = val.substring(prefix.length).trim();
          if (displayLabel.startsWith('-') || displayLabel.startsWith('_')) {
            displayLabel = displayLabel.substring(1).trim();
          }
        }
      }
    }
    return { label: displayLabel, cleanVal };
  };

  const getDisplayLabel = (val, prefix) => {
    if (!prefix) return val;
    let label = val;
    if (val.toLowerCase().startsWith(prefix.toLowerCase())) {
      label = val.substring(prefix.length).trim();
      if (label.startsWith('-') || label.startsWith('_')) {
        label = label.substring(1).trim();
      }
    }
    return label;
  };

  return {
    renderLayout: function(data, state, settings) {
      const isHorizontal = settings?.collection?.filterPosition === 'top';
      const showFilters = settings?.collection?.showFilters !== false;
      const primaryColor = settings?.collection?.primaryColor || '#000000';

      let sidebarHtml = '';
      if (showFilters && data.settings && data.facets) {
        sidebarHtml = this.renderSidebar(data.facets, data.settings, state, settings);
      }

      let gridHtml = '';
      if (data.products && data.products.length > 0) {
        gridHtml = this.renderGrid(data.products, state, settings, data.mergedValues);
      } else {
        gridHtml = this.renderEmptyState(state);
      }

      let paginationHtml = '';
      if (data.products && data.products.length > 0) {
        paginationHtml = this.renderPagination(data.totalCount, state, settings);
      }

      // Drawer overlay and Top Bar (V1 design)
      let overlayHtml = `<div id="cfp-overlay" class="cfp-overlay" aria-hidden="true"></div>`;
      
      let topBarHtml = `
        <div id="cfp-top-bar" class="cfp-top-bar" style="display: flex;">
          <div class="cfp-top-bar__left">
            <button id="cfp-drawer-trigger-btn" class="cfp-drawer-trigger-btn" aria-label="Open filters" aria-expanded="false" aria-controls="cfp-sidebar">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="7" x2="19" y2="7"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <line x1="5" y1="17" x2="19" y2="17"></line>
              </svg>
              <span>Filters</span>
              <span class="cfp-active-badge" id="cfp-active-count" style="display:none;">0</span>
            </button>
          </div>
          <div class="cfp-top-bar__right">
            <div class="cfp-custom-sort" id="cfp-custom-sort">
              <div class="cfp-custom-sort__trigger" id="cfp-custom-sort-trigger">
                <span id="cfp-custom-sort-label">Best selling</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
              <div class="cfp-custom-sort__dropdown" id="cfp-custom-sort-dropdown">
                <div class="cfp-custom-sort__option" data-value="best-selling">Best selling</div>
                <div class="cfp-custom-sort__option" data-value="price-ascending">Price: Low to High</div>
                <div class="cfp-custom-sort__option" data-value="price-descending">Price: High to Low</div>
                <div class="cfp-custom-sort__option" data-value="created-descending">Date: New to Old</div>
              </div>
            </div>
          </div>
        </div>
      `;

      return `
        ${overlayHtml}
        ${sidebarHtml}
        <div class="cfp-layout-wrapper" style="display: block; --cfp-primary: ${primaryColor};">
          ${topBarHtml}
          <div class="cfp-main-content" style="width: 100%;">
            ${gridHtml}
            ${paginationHtml}
          </div>
        </div>
      `;
    },

    renderEmptyState: function(state) {
      return `
        <div class="cfp-no-products" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; text-align: center; color: #475569;">
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 16px;"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path><circle cx="9" cy="14" r="1" fill="#94a3b8"></circle><circle cx="15" cy="14" r="1" fill="#94a3b8"></circle><path d="M10 18c1-1 3-1 4 0"></path></svg>
          <p style="margin: 0;">No products match your selected filters.</p>
          <button class="cfp-btn cfp-btn--primary" id="cfp-reset-inline" style="max-width: 137px; margin: 23px auto 0; width: 100%; background: var(--cfp-primary); color: white; border: none; padding: 10px; cursor: pointer; border-radius: 4px;">Reset Filters</button>
        </div>
      `;
    },

    renderPagination: function(totalCount, state, settings) {
      const pageSize = 28; // Default
      const currentPage = parseInt(state.page || 1);
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      
      if (currentPage >= totalPages) return '';

      const viewedCount = Math.min(currentPage * pageSize, totalCount);
      const percentage = Math.round((viewedCount / totalCount) * 100);

      return `
        <div class="cfp-load-more-container" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 0; width: 100%; clear: both;">
          <div class="cfp-progress-text" style="margin-bottom: 15px; font-size: 14px; color: #4a4a4a;">
            You've viewed ${viewedCount} of ${totalCount} products
          </div>
          <div class="cfp-progress-bar-container" style="width: 250px; height: 4px; background-color: #e0e0e0; margin-bottom: 20px; border-radius: 2px; overflow: hidden;">
            <div class="cfp-progress-bar" style="width: ${percentage}%; height: 100%; background-color: var(--cfp-primary); transition: width 0.3s ease;"></div>
          </div>
          <button class="cfp-btn cfp-btn--primary" id="cfp-load-more-btn" data-next-page="${currentPage + 1}" style="max-width: 300px; padding: 12px 40px; font-weight: bold; cursor: pointer; background: var(--cfp-primary); color: white; border: none; border-radius: 4px;">
            LOAD MORE
          </button>
        </div>
      `;
    },

    renderGrid: function(products, state, settings, mergedValues) {
      const conf = window.location.pathname.includes('/search') ? (settings?.search || {}) : (settings?.collection || {});
      const desktopCols = conf.desktopColumns || 4;
      const mobileCols = conf.mobileColumns || 2;
      const primaryColor = conf.primaryColor || '#000000';
      const currencySymbol = window.CFP_V2.currencySymbol || '$';

      const showBorder = conf.showBorder ? 'cfp-grid-bordered' : '';
      const textAlign = `cfp-text-${conf.textAlign || 'left'}`;
      const mediaAspect = `cfp-aspect-${conf.mediaAspect || 'rectangle'}`;
      const imgClass = conf.imageSize === 'contain' ? 'cfp-img-contain' : '';
      
      const saleLabelType = conf.saleLabelType || 'text';
      const saleLabelPos = conf.saleLabelPos || 'top-left';
      const saleBg = conf.saleBg || '#FF4E4E';
      const saleText = conf.saleText || '#FFFFFF';
      
      const soldoutPos = conf.soldoutPos || 'top-left';
      const soldoutBg = conf.soldoutBg || '#000000';
      const soldoutText = conf.soldoutText || '#FFFFFF';

      let html = `<div class="cfp-products-grid ${showBorder} ${textAlign} ${mediaAspect}" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; --cfp-desktop-cols: ${desktopCols}; --cfp-mobile-cols: ${mobileCols};">`;
      
      html += products.map(product => {
        let displayTitle = product.title && product.title !== "undefined" ? product.title : 'Product';
        let productUrl = `/products/${product.handle}`;
        
        let parsedImages = product.images;
        if (typeof product.images === 'string') {
           if (product.images === 'undefined' || product.images.trim() === '') {
              parsedImages = [];
           } else {
              try { parsedImages = JSON.parse(product.images); } catch(e) { parsedImages = []; }
           }
        }
        
        let firstImg = null;
        if (parsedImages && parsedImages.length > 0) {
            let imgObj = parsedImages[0];
            if (typeof imgObj === 'string') {
                firstImg = imgObj;
            } else if (imgObj) {
                firstImg = imgObj.url || imgObj.src;
            }
        }
        
        if (firstImg === 'undefined' || firstImg === undefined) firstImg = null;
        
        let primaryImg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj4KICA8cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZWVlIi8+CiAgPHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMCIgZmlsbD0iI2FhYSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIEltYWdlPC90ZXh0Pgo8L3N2Zz4=';
        if (product.merchandisingImage && product.merchandisingImage !== 'undefined') {
            primaryImg = product.merchandisingImage;
        } else if (firstImg) {
            primaryImg = firstImg;
        }
        
        let basePrice = (product.priceMin !== undefined && product.priceMin !== null && product.priceMin !== "undefined") ? parseFloat(product.priceMin) : 0;
        let comparePrice = (product.variants?.[0]?.compareAtPrice && product.variants?.[0]?.compareAtPrice !== "undefined") ? parseFloat(product.variants[0].compareAtPrice) : 0;
        
        let isSoldOut = product.available === false || product.inventory_quantity <= 0; // Check availability if present
        let onSale = comparePrice > basePrice;

        const priceStr = basePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const compPriceStr = comparePrice ? comparePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';

        let saleBadgeHtml = '';
        if (onSale && !isSoldOut) {
           let badgeText = 'Sale';
           if (saleLabelType === 'percent') {
              badgeText = '-' + Math.round(((comparePrice - basePrice) / comparePrice) * 100) + '%';
           } else if (saleLabelType === 'amount') {
              badgeText = '-' + currencySymbol + (comparePrice - basePrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
           }
           saleBadgeHtml = `<span class="cfp-product-card__badge cfp-badge--${saleLabelPos}" style="background: ${saleBg}; color: ${saleText};">${badgeText}</span>`;
        }

        let soldOutBadgeHtml = '';
        if (isSoldOut) {
           soldOutBadgeHtml = `<span class="cfp-product-card__badge cfp-badge--${soldoutPos}" style="background: ${soldoutBg}; color: ${soldoutText};">Sold Out</span>`;
        }

        let swatchesHtml = '';
        let matchedColorUrl = "";
        
        if (product.options) {
           try {
             const parsedOptions = typeof product.options === 'string' ? JSON.parse(product.options) : product.options;
             const colorOptionIndex = parsedOptions.findIndex(o => o.name && (o.name.toLowerCase() === 'color' || o.name.toLowerCase() === 'colour'));
             
             if (colorOptionIndex !== -1 && product.variants) {
                const optionKey = `option${colorOptionIndex + 1}`;
                const uniqueColors = new Map();
                product.variants.forEach(v => {
                  if (v[optionKey] && !uniqueColors.has(v[optionKey]) && v.imageUrl && v.imageUrl !== "undefined" && v.imageUrl !== "null") {
                    const numericId = v.id ? v.id.replace('gid://shopify/ProductVariant/', '') : '';
                    uniqueColors.set(v[optionKey], { imgUrl: v.imageUrl, variantId: numericId });
                  }
                });

                if (uniqueColors.size > 0) {
                  swatchesHtml += `<div class="cfp-product-swatches">`;
                  const colorsArray = Array.from(uniqueColors.entries());
                  
                  let activeIndex = 0;
                  
                  // 1. Check if there's a search query matching a color
                  if (state.q && state.q.trim() !== "") {
                     const qLower = state.q.toLowerCase().trim();
                     const foundIndex = colorsArray.findIndex(c => c[0].toLowerCase().includes(qLower) || qLower.includes(c[0].toLowerCase()));
                     if (foundIndex !== -1) {
                        activeIndex = foundIndex;
                     }
                  } else if (state.options && Object.keys(state.options).length > 0) {
                     let selectedValues = [];
                     Object.values(state.options).forEach(arr => selectedValues.push(...arr));
                     if (mergedValues && mergedValues.length > 0) {
                         const expanded = [...selectedValues];
                         for(const v of selectedValues) {
                             const rules = mergedValues.filter(m => m.targetValue.toLowerCase() === v.toLowerCase());
                             for(const r of rules) {
                                 expanded.push(...r.sourceValues);
                             }
                         }
                         selectedValues = expanded;
                     }
                     const expandedLower = selectedValues.map(x => x.toLowerCase());
                     const foundIndex = colorsArray.findIndex(c => expandedLower.includes(c[0].toLowerCase()));
                     if (foundIndex !== -1) {
                        activeIndex = foundIndex;
                     }
                  }

                  matchedColorUrl = colorsArray[activeIndex][1].imgUrl;

                  colorsArray.forEach(([colorName, data], index) => {
                     const isHidden = index >= 5 ? 'cfp-swatch-hidden' : '';
                     const isActive = index === activeIndex ? 'cfp-swatch-active' : '';
                     
                     swatchesHtml += `<div class="cfp-swatch-item ${isHidden} ${isActive}" 
                          data-tooltip="${colorName}" 
                          onclick="event.preventDefault(); 
                                   const card = this.closest('.cfp-product-card');
                                   const img = card.querySelector('.cfp-product-card__image-container img');
                                   if (img) img.src='${data.imgUrl}';
                                   const swatches = this.closest('.cfp-product-swatches').querySelectorAll('.cfp-swatch-item');
                                   swatches.forEach(s => s.classList.remove('cfp-swatch-active'));
                                   this.classList.add('cfp-swatch-active');
                                   if('${data.variantId}') card.querySelector('a').href='/products/${product.handle}?variant=${data.variantId}';">
                        <img src="${data.imgUrl}" alt="${colorName}" />
                     </div>`;
                  });
                  
                  if (colorsArray.length > 5) {
                     const extraCount = colorsArray.length - 5;
                     swatchesHtml += `<div class="cfp-swatch-more" 
                          onclick="event.preventDefault(); 
                                   const container = this.closest('.cfp-product-swatches');
                                   const hiddenItems = container.querySelectorAll('.cfp-swatch-item:nth-child(n+6)');
                                   const isExpanded = this.textContent.startsWith('-');
                                   hiddenItems.forEach(item => item.classList.toggle('cfp-swatch-hidden'));
                                   this.textContent = isExpanded ? '+' + ${extraCount} : '-' + ${extraCount};
                          ">+${extraCount}</div>`;
                  }
                  swatchesHtml += `</div>`;
                  
                  if (matchedColorUrl) {
                     primaryImg = matchedColorUrl;
                     if (!productUrl.includes('?variant=') && colorsArray[activeIndex][1].variantId) {
                         productUrl += `?variant=${colorsArray[activeIndex][1].variantId}`;
                     }
                  }
                }
             }
           } catch(e) {}
        }

        if (!primaryImg || primaryImg === 'undefined' || primaryImg === 'null') {
            primaryImg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj4KICA8cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZWVlIi8+CiAgPHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMCIgZmlsbD0iI2FhYSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIEltYWdlPC90ZXh0Pgo8L3N2Zz4=';
        }

        return `
          <div class="cfp-product-card">
            <a href="${productUrl}" class="cfp-product-card__link">
              <div class="cfp-product-card__image-container">
                <img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" data-src="${primaryImg}" alt="${product.title}" class="cfp-product-card__image cfp-product-card__image--primary cfp-lazy ${imgClass}" />
                ${isSoldOut ? soldOutBadgeHtml : saleBadgeHtml}
              </div>
              <div class="cfp-product-card__info">
                ${product.vendor && product.vendor !== "undefined" ? `<span class="cfp-product-card__vendor">${product.vendor}</span>` : ''}
                <h3 class="cfp-product-card__title">${displayTitle}</h3>
                ${swatchesHtml}
                <div class="cfp-product-card__price-row">
                  <span class="cfp-product-card__price">${currencySymbol}${priceStr}</span>
                  ${onSale ? `<span class="cfp-product-card__compare-price">${currencySymbol}${compPriceStr}</span>` : ''}
                </div>
              </div>
            </a>
          </div>
        `;
      }).join('');
      
      html += `</div>`;

      // Schedule lazy image activation after HTML is inserted into DOM
      requestAnimationFrame(() => window.CFP_V2.initLazyImages && window.CFP_V2.initLazyImages());

      return html;
    },

    renderSidebar: function(facets, facetSettings, state, settings) {
      const activeFilters = state;
      const globalSettings = settings.global || {};
      const config = settings || {};
      const activeArray = [];
      if (activeFilters.options) {
         Object.values(activeFilters.options).forEach(arr => activeArray.push(...arr));
      }
      if (activeFilters.tags) activeArray.push(...activeFilters.tags);
      if (activeFilters.metafields) {
         Object.values(activeFilters.metafields).forEach(arr => activeArray.push(...arr));
      }
      if (activeFilters.vendors) activeArray.push(...activeFilters.vendors);
      if (activeFilters.productTypes) activeArray.push(...activeFilters.productTypes);

      let html = `<div id="cfp-sidebar" class="cfp-sidebar" role="complementary" aria-label="Product Filters" aria-hidden="true">`;
      html += `
        <div class="cfp-sidebar__header">
          <div class="cfp-sidebar__header-info">
            <span class="cfp-sidebar__title">${globalSettings.filterHeading || 'Filters'}</span>
          </div>
          <button id="cfp-close-btn" class="cfp-close-btn" aria-label="Close filters">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="cfp-sidebar__body">
      `;

      facetSettings.forEach((setting, index) => {
        if (!setting.isEnabled) return;
        let type = setting.filterType || setting.type;
        const key = setting.filterKey || setting.key;
        const displayMode = setting.displayMode || "List";
        const adv = setting.advanced || {};
        const prefix = adv.tagPrefix || "";

        let items = [];
        let groupContent = "";

        if (type === 'price') {
          let absMin = 0;
          let absMax = 1000;
          if (facets.priceRanges) {
            if (facets.priceRanges.minLimit !== undefined) absMin = facets.priceRanges.minLimit;
            if (facets.priceRanges.maxLimit !== undefined) absMax = facets.priceRanges.maxLimit;
          }
          const minVal = activeFilters.priceMin !== undefined ? activeFilters.priceMin : absMin;
          const maxVal = activeFilters.priceMax !== undefined ? activeFilters.priceMax : absMax;

          const leftPct = ((minVal - absMin) / (absMax - absMin)) * 100 || 0;
          const rightPct = 100 - (((maxVal - absMin) / (absMax - absMin)) * 100 || 100);

          const points = 5;
          let ticksHtml = '<div class="cfp-slider-ticks" style="position: relative; height: 24px; margin-top: 10px; width: 100%;">';
          const formatValue = (val) => {
            if (val === 0) return '0';
            if (val >= 1000000) return (val / 1000000).toFixed(1).replace('.0', '') + 'M';
            if (val >= 1000) return (val / 1000).toFixed(1).replace('.0', '') + 'k';
            return val.toFixed(0);
          };
          for (let i = 0; i < points; i++) {
            const percent = (i / (points - 1)) * 100;
            const val = absMin + (i / (points - 1)) * (absMax - absMin);
            ticksHtml += `
              <div style="position: absolute; left: ${percent}%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; top: 0; z-index: 0; pointer-events: none;">
                <span style="font-size: 11px; color: #6d7175; font-weight: 400;">${formatValue(val)}</span>
              </div>
            `;
          }
          ticksHtml += '</div>';

          groupContent = `
            <div class="cfp-price-slider-wrapper" style="padding: 10px 10px 20px 10px;">
              <div class="cfp-price-inputs">
                <div class="cfp-price-input-wrap">
                  <div class="cfp-price-field">
                    <input type="number" id="cfp-price-min-display" class="cfp-price-input" value="${minVal}" min="${absMin}" max="${absMax}">
                  </div>
                </div>
                <span class="cfp-price-divider">-</span>
                <div class="cfp-price-input-wrap">
                  <div class="cfp-price-field">
                    <input type="number" id="cfp-price-max-display" class="cfp-price-input" value="${maxVal}" min="${absMin}" max="${absMax}">
                  </div>
                </div>
              </div>
              <div class="cfp-range-track" id="cfp-slider-track" style="position: relative; margin-bottom: 0;">
                <div class="cfp-range-fill" id="cfp-range-track" style="left: ${leftPct}%; right: ${rightPct}%;"></div>
                <input type="range" id="cfp-slider-range-min" class="cfp-range-input cfp-slider-range-min cfp-filter-checkbox" data-price="min" min="${absMin}" max="${absMax}" value="${minVal}" step="1">
                <input type="range" id="cfp-slider-range-max" class="cfp-range-input cfp-slider-range-max cfp-filter-checkbox" data-price="max" min="${absMin}" max="${absMax}" value="${maxVal}" step="1">
              </div>
              ${ticksHtml}
            </div>
          `;
        } else {
          if (type === 'vendor') items = facets.vendors || [];
          else if (type === 'product_type') items = facets.productTypes || [];
          else if (type === 'collection') items = facets.collections || [];
          else if (type === 'tag' || type === 'tags') items = facets.tags || [];
          else if (type === 'title') items = facets.titles || [];
          else if (type === 'option') items = facets.options?.[key] || [];
          else if (type === 'metafield') items = facets.metafields?.[key] || [];

          if (adv.sortType === "Alphabetical A-Z") items.sort((a,b) => a.value.localeCompare(b.value));
          else if (adv.sortType === "Alphabetical Z-A") items.sort((a,b) => b.value.localeCompare(a.value));
          else if (adv.sortType === "Product count - Highest to lowest") items.sort((a,b) => b.count - a.count);
          else if (adv.sortType === "Product count - Lowest to highest") items.sort((a,b) => a.count - b.count);

          if (!items || items.length === 0) return;

          const inputName = (type === 'option') ? `option-${key}` : (type === 'metafield') ? `metafield-${key}` : type;

          let resolvedMode = displayMode;
          if (resolvedMode.toLowerCase() === 'chips' || resolvedMode.toLowerCase() === 'buttons') resolvedMode = 'Box/Button';
          if (type === 'option' && key.toLowerCase().includes('size')) resolvedMode = 'Box/Button';

          const showMoreType = adv.showMoreType || "Scrollbar";
          const limit = 6;
          const isViewMore = (showMoreType === "View more" || showMoreType === "View more with scrollbar") && items.length > limit;
          const scrollClass = (showMoreType === "Scrollbar" || showMoreType === "View more with scrollbar") && items.length > limit ? "cfp-scroll-area" : "";
          const scrollStyle = scrollClass ? `style="max-height: ${adv.maxHeight || '300px'};"` : "";

          const renderViewMoreBtn = () => {
            if (!isViewMore) return '';
            return `<div class="cfp-view-more-action" style="margin-top: 8px;"><button type="button" class="cfp-view-more-btn" style="background: none; border: none; color: #007bff; cursor: pointer; padding: 0; font-size: 13px; text-decoration: underline;">+ View more</button></div>`;
          };

          const hasSearch = adv.desktopSearchBox;
          let searchHtml = hasSearch ? `
              <div class="cfp-search-input-wrap">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" class="cfp-search-input cfp-vendor-search" placeholder="Filter options">
              </div>
          ` : '';

          if (resolvedMode === "Dropdown") {
            groupContent = `
              <select class="cfp-select cfp-filter-checkbox" name="${inputName}">
                <option value="">Any ${setting.label}</option>
                ${items.map(item => `
                  <option value="${item.value}" ${(activeArray.includes(item.value) || ((type === 'tag' || type === 'tags') && activeArray.includes(getCleanLabel('tag', item.value).cleanVal))) ? 'selected' : ''}>
                    ${getDisplayLabel(item.label || item.value, prefix)} ${globalSettings && globalSettings.showProductCount === false ? '' : ` (${item.count})`}
                  </option>
                `).join('')}
              </select>
            `;
          } else if (resolvedMode === "Swatch") {
            const swatchConf = config.swatchConfig || {};
            const isCircle = swatchConf.circleSwatch !== false;
            
            groupContent = `
              ${searchHtml}
              <div class="${scrollClass}" ${scrollStyle}>
                <div class="cfp-color-grid cfp-color-grid--list">
                  ${items.map((item, idx) => {
                    let colorValue = getColorHex(item.value);
                    const hide = isViewMore && idx >= limit;
                    const isActive = activeArray.includes(item.value) || ((type === 'tag' || type === 'tags') && activeArray.includes(getCleanLabel('tag', item.value).cleanVal));
                    const isWhite = (colorValue.toLowerCase() === '#ffffff' || colorValue.toLowerCase() === 'white' || item.value.toLowerCase() === 'white');
                    const bgStyle = `background:${colorValue};`;
                    const visualHtml = `<span class="cfp-swatch-circle" style="${bgStyle} width: 22px; height: 22px; display: inline-block; ${isCircle ? 'border-radius: 50%;' : 'border-radius: 4px;'} border: 1px solid ${isWhite ? '#ddd' : '#e1e3e5'}; ${isActive ? 'box-shadow: 0 0 0 2px #000;' : ''} flex-shrink: 0;"></span>`;
                    
                    return `
                      <label class="cfp-color-swatch ${hide ? 'cfp-view-more-hidden' : ''}" style="${hide ? 'display: none;' : ''} display: flex; align-items: center; gap: 8px; cursor: pointer; flex-direction: row; justify-content: flex-start; text-align: center; width: 100%; box-sizing: border-box;" title="${item.value} ${globalSettings && globalSettings.showProductCount === false ? '' : ` (${item.count})`}">
                        <input type="checkbox" class="cfp-filter-checkbox" name="${inputName}" value="${item.value}" ${isActive ? 'checked' : ''} style="display:none;">
                        ${visualHtml}
                        <span class="cfp-swatch-label" style="font-family: 'Poppins', sans-serif; font-size: 15px; text-align: left; color: #202223;">${getDisplayLabel(item.value, prefix)}</span>
                      </label>
                    `;
                  }).join('')}
                </div>
                ${renderViewMoreBtn()}
              </div>
            `;
          } else if (resolvedMode === "Box/Button" || resolvedMode === "Button" || resolvedMode === "Box") {
            groupContent = `
              ${searchHtml}
              <div class="${scrollClass}" ${scrollStyle}>
                <div class="cfp-button-grid">
                  ${items.map((item, idx) => {
                    const hide = isViewMore && idx >= limit;
                    const isActive = (activeArray.includes(item.value) || ((type === 'tag' || type === 'tags') && activeArray.includes(getCleanLabel('tag', item.value).cleanVal)));
                    return `
                    <label class="cfp-button-chip ${hide ? 'cfp-view-more-hidden' : ''} ${isActive ? 'cfp-swatch-active' : ''}" style="${hide ? 'display: none;' : ''}" title="${item.value} ${globalSettings && globalSettings.showProductCount === false ? '' : ` (${item.count})`}">
                      <input type="checkbox" class="cfp-filter-checkbox" name="${inputName}" value="${item.value}" ${isActive ? 'checked' : ''}>
                      <span>${getDisplayLabel(item.label || item.value, prefix)}</span>
                    </label>
                    `;
                  }).join('')}
                </div>
                ${renderViewMoreBtn()}
              </div>
            `;
          } else { // Default List
            groupContent = `
              ${searchHtml}
              <div class="${scrollClass}" ${scrollStyle}>
                ${items.map((item, idx) => {
                  const hide = isViewMore && idx >= limit;
                  const isActive = (activeArray.includes(item.value) || ((type === 'tag' || type === 'tags') && activeArray.includes(getCleanLabel('tag', item.value).cleanVal)));
                  return `
                  <label class="cfp-checkbox ${hide ? 'cfp-view-more-hidden' : ''}" style="${hide ? 'display: none;' : ''}">
                    <input type="checkbox" class="cfp-filter-checkbox" name="${inputName}" value="${item.value}" ${isActive ? 'checked' : ''}>
                    <span class="cfp-checkbox__box"></span>
                    <span class="cfp-checkbox__label">${getDisplayLabel(item.label || item.value, prefix)}</span>
                    <span class="cfp-checkbox__count">${item.count}</span>
                  </label>
                  `;
                }).join('')}
                ${renderViewMoreBtn()}
              </div>
            `;
          }
        }

        html += `
          <div class="cfp-group cfp-group-${type}" style="margin-bottom: 20px;">
            <button class="cfp-group__toggle" aria-expanded="true" aria-controls="cfp-content-${index}" style="width: 100%; display: flex; justify-content: space-between; background: none; border: none; padding: 10px 0; font-weight: 600; cursor: pointer;">
              <span>${setting.label}</span>
              <svg class="cfp-chevron" width="12" height="12" viewBox="0 0 20 20" style="fill: currentColor;"><path d="M5 8l5 5 5-5z" /></svg>
            </button>
            <div id="cfp-content-${index}" class="cfp-group__content" style="padding-top: 10px;">
              ${groupContent}
            </div>
          </div>
        `;
      });

      html += `</div>`; // body
      html += `<div class="cfp-sidebar__footer"><button class="cfp-btn cfp-btn--apply-all" id="cfp-apply-btn">VIEW ALL RESULTS</button></div>`;
      html += `</div>`; // sidebar
      return html;
    }
  };
})();
