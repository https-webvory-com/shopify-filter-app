(function () {
  // Theme assets can execute again after a section replacement. Keep one set
  // of document listeners; delegated clicks also cover replacement controls.
  if (window.__tdoLocationPopupInitialized) return;
  window.__tdoLocationPopupInitialized = true;

  var cookieTimer = null;
  var pendingCookieText = '';

  function showLocationPopup() {
    var popup = document.querySelector('.location_popup');
    if (!popup || !window.Shopify || window.Shopify.country === 'US') return;
    var lastClosed;
    try { lastClosed = localStorage.getItem('location_popup_closed'); } catch (_) {}
    var recentlyClosed = lastClosed &&
      (new Date() - new Date(lastClosed)) / (1000 * 60 * 60 * 24) < 7;
    popup.style.display = recentlyClosed ? 'none' : 'block';
  }

  function closeLocationPopup() {
    var popup = document.querySelector('.location_popup');
    if (!popup) return;
    popup.style.display = 'none';
    try {
      localStorage.setItem('location_popup_closed', new Date().toISOString());
    } catch (_) {}
  }

  function applyCookieText() {
    var cookieText = document.querySelector('.shopify-pc__banner__body p');
    if (!cookieText) return false;
    cookieText.innerHTML = pendingCookieText;
    if (cookieTimer !== null) clearInterval(cookieTimer);
    cookieTimer = null;
    return true;
  }

  function updateTextForElements(data) {
    if (!data) return;
    var helperText = document.querySelector('.location_popup_text');
    if (helperText) helperText.innerText = data.main_text || '';
    for (var index = 1; index <= 5; index++) {
      var icon = document.querySelector('#loc_popup-icon-' + index + ' .item_title');
      if (icon && data['icon_' + index]) icon.innerText = data['icon_' + index];
    }
    if (data.cookie_text) {
      pendingCookieText = data.cookie_text;
      // Preserve delayed consent-banner support without creating a new timer
      // each time a Shopify section is initialized.
      if (!applyCookieText() && cookieTimer === null) {
        cookieTimer = setInterval(applyCookieText, 100);
      }
    }
  }

  function updateHelperText() {
    var country = window.Shopify && window.Shopify.country;
    var languages = typeof metaLanguages === 'undefined' ? null : metaLanguages;
    updateTextForElements((languages && languages[country]) || {
      main_text: 'FREE International Shipping with a minimum purchase of $99.'
    });
  }

  function initialize() {
    updateHelperText();
    showLocationPopup();
  }

  // Preserve functions used by existing theme markup and other theme scripts.
  window.showLocationPopup = showLocationPopup;
  window.closeLocationPopup = closeLocationPopup;
  window.updateTextForElements = updateTextForElements;
  window.updateHelperText = updateHelperText;

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (target && typeof target.closest === 'function' &&
        target.closest('#close_location_popup, .location_popup_overlay')) {
      closeLocationPopup();
    }
  });
  document.addEventListener('shopify:section:load', initialize);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, {once: true});
  } else {
    initialize();
  }
})();
