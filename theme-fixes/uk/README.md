Local fix for the UK theme's `assets/lang.js`
============================================

This asset replaces the theme script that throws when `#close_location_popup`
is absent on the UK search page. The source was traced to the published theme's
`/cdn/shop/t/15/assets/lang.js` on 2026-11-19. CDN `t/15` is not a Shopify theme ID.

The fix preserves the existing popup functions, country text, seven-day dismissal
and delayed cookie-banner text. Popup elements are optional, initialization works
before or after DOMContentLoaded, and one delegated click listener handles controls
inserted or replaced later. Repeated script/section initialization does not multiply
click handlers or cookie timers.

This is a theme asset, separate from the app extension. It is deliberately stored
here rather than added to the app renderer. It has not been pushed, deployed or
uploaded to Shopify. Browser verification replaces this one script only inside an
isolated browser session; the live theme remains unchanged.

Verification: `node --test tests/theme/location-popup.test.mjs` passes all seven
focused tests. The isolated browser check also passed search submission, colour
filtering, both sort rerenders, product navigation and Back, with no target
exception. Real DOM replacement and repeated script execution kept exactly one
document click listener and one close action per click. Proof is saved locally at
`scratch/local-theme-event-fix-browser-proof-20261119.json`.
