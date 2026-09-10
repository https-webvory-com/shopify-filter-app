# Quick View implementation report

## Audit before implementation

- Entry points: `collectionFilterPro.js` and `instantSearch.js` render `.cfp-quick-view-btn`. Their Liquid snippet/block load the same `quickView.js` and CSS; delegated clicks use one singleton.
- Data: `api.filter.jsx` and `api.search.jsx` return global settings from `filterSettings.server.js`, cached by `shopCache.server.js` for 60 seconds. Product cards do not provide the complete Shopify Ajax product/options contract. Quick View fetches product JSON and posts variant IDs to the Ajax cart API.
- Settings: General Settings saves `FilterGlobalSetting` through Prisma; updates invalidate shop caches. Existing setup uses `prisma db push`, so the deployment migration must be applied before that command to preserve old-store defaults.
- Size chart: fetches product HTML only on click, imports a particular `x-modal`, and delegates lifecycle to the theme. No native Quick View adapter or verified theme/version allowlist exists. Theme setup queries Admin themes for app activation only.
- Problems: hidden Default Title options cause variant matching failure; missing combinations retain stale IDs; capped images can select the wrong photo; error responses can be treated as cart success; keyboard/modal lifecycle is incomplete; size links appear before applicability is known; product URLs ignore locale. No existing Quick View tests were found.
- Plan: preserve the renderer and shared entry points; add explicit settings and a data migration; centralize theme capabilities behind an adapter registry; hide chart controls until detection succeeds; synchronize variant state and cart lifecycle; add focused automated tests and mobile/browser checks.

## Theme support boundary

Both modes are implemented: **App default** and **Theme Quick View when available**. The theme selection is an automatic preference, not a claim that every Shopify theme is supported. The first native adapter supports the Dawn Quick Add component interface, tested against Shopify Dawn commit `258f00f64365e2018ca4c62778a6bf55a5d3cd18`. It checks the loaded components, native preprocessing/rendering APIs, and modal styling at runtime. Missing or incompatible capabilities fall back to App default.

The adapter reuses an existing Quick Add modal or constructs Dawn's documented empty dialog shell when scripts/styles are loaded but no modal was rendered (for example, a grid of single-variant products). It fetches locale-aware product HTML, passes only `product-info` through Dawn's own Quick Add preprocessing and renderer, and opens the native dialog. Dawn's product components continue to own variant selection, price, media and Add to Cart. Full page content and recommendations are not injected. Loading has cancellation and a ten-second fallback deadline; late responses cannot open or clear another product's modal.

In App mode, supported native modal-opener buttons are hidden and replaced with App Quick View buttons in the same position. A scoped capability check and mutation observer cover re-rendered cards. Switching to Theme mode restores the original buttons and inline display state. A capture listener ensures one handler owns each Quick View click. Ordinary one-click Add to Cart buttons and Shopify's saved theme settings are untouched. Native takeover follows `showQuickViewCollection`; instant-search cards follow their existing independent enable flag. This works on pages where the app's extension scripts are loaded.

Other native interfaces, such as commercial themes' `quick-buy-modal`, are not yet integrated. They use App Quick View on app-rendered cards; their unknown native controls are not guessed at or hidden. The existing `x-modal` size-chart bridge is separate from native Quick View capability.

The configured development store, `collection-filter-pro.myshopify.com`, redirects to its password page. Tests use real Dawn JavaScript with synthetic HTML/API responses, not this store's theme. No live-store changes or purchases were made.

## Implemented changes

| Files | Change |
| --- | --- |
| `app/routes/app.settings.general.jsx` | Enables both modes and preserves the selected style when other toggles are saved. Unknown mode values become App default; old admin submissions preserve omitted settings. Includes the independent size-chart toggle and compatibility helper text. |
| `app/services/filterSettings.server.js` | Waits for Redis invalidation before completing a save. |
| `app/routes/api.quick-view.jsx` | Lightweight public configuration endpoint for pages that have not opened search. Validates shop domain, rate limits requests, returns only five storefront flags, and never creates shop rows. Uses a separate 60-second cache that is invalidated with other shop settings. |
| `prisma/schema.prisma`, `prisma/migrations/20260910000000_quick_view_settings/migration.sql` | Adds `quickViewStyle` and `showQuickViewSizeChart`. Existing settings rows receive true; new rows default to false. |
| `extensions/theme-extension/assets/quickViewAdapters.js` | Implements the Dawn native adapter, native button replacement/restoration, popup cleanup, ownership/cancellation protection, and existing chart/cart bridges. |
| `extensions/theme-extension/assets/quickView.js` | Keeps the existing renderer; adds explicit option state, correct variant/image/price/SKU synchronization, cart locking/recovery/timeout, locale-aware URLs, request coalescing, and modal focus lifecycle. Size charts are detected before the link appears; no chart request occurs when disabled or the bridge is unsupported. |
| `extensions/theme-extension/assets/quickView.css` | Adds keyboard focus styles, accessible control sizes/contrast, mobile scrolling and sticky close, and reduced-motion behavior. |
| `extensions/theme-extension/blocks/instant_search.liquid`, `extensions/theme-extension/snippets/collectionFilterPro.liquid` | Load the shared adapter before Quick View. Instant search also receives the active currency fallback. |
| `extensions/theme-extension/assets/collectionFilterPro.js`, `extensions/theme-extension/assets/instantSearch.js` | Apply shared configuration from API responses. Instant Search leaves Escape to an open native Quick View. Initial collection responses are reused so those pages do not need an extra settings request. |
| `tests/quick-view/*` | Browser fixtures, repeatable browser runner, and server-side settings/cache tests. |

### Data and theme behavior

- Product requests use Shopify's locale root and obtain fresh Ajax product data on reopening. Concurrent requests for the same URL are coalesced. Search/index records are not reused as complete products because their option/availability shape is different and may be stale.
- Cart calls retain the Ajax `cart/add.js` endpoint and bundled cart sections. Availability comes from Shopify's `variant.available`, including untracked inventory and continue-selling behavior. Failed HTTP responses never show success. A timeout advises checking the cart before retrying because a timed-out write may already have reached Shopify.
- An enabled compatible size-chart bridge fetches product HTML for the selected variant, extracts only the chart, removes scripts/inline handlers, and imports only that node. It never inserts the full product template or recommendations. Extracted chart HTML/absence is cached for 30 seconds, bounded to 20 entries, with keys including locale, variant and preview theme. Changing variants cancels stale chart work. Clicking a detected chart performs no additional fetch.
- `getSizeChart` is the extension point for future product-specific/default chart providers. No merchant page selector or default chart has been added. Today a compatible existing theme chart is required.
- Native adapter contract: runtime capability resolution, `open({ handle, trigger, settings, signal })` returning true only when the native view opened successfully, and `close()` for cleanup. Native mode retains theme cart behavior; the app's retail/wholesale restriction forces App Quick View for logged-out wholesale visitors. Dawn removes product popup dialogs from Quick Add; the adapter also removes their orphan openers so a product-page size chart does not become a broken Quick View link. Popup filtering is reapplied to theme-driven product swaps.

## Rollout / migration

No database migration was run in this workspace; `DATABASE_URL` is not configured.

Apply the **new additive SQL migration before the existing `setup` / `prisma db push` workflow**. The order matters: running db push first would create the new Boolean with false for existing stores, losing the intended old-store behavior. The SQL first adds the column with true for existing records, then changes its default to false for newly created settings records. Existing merchant choices must never be overwritten on subsequent deployments.

Use the deployment's established migration tracking. This repository has a history of db-push changes, so check the existing migration baseline before running all historical migrations. For an installation managed by db push, apply only the supplied new SQL to the existing schema through the deployment process; do not blindly replay historical migrations. Regenerate Prisma Client, deploy the app and theme extension together, and allow existing 60-second settings cache entries to expire or invalidate them.

If db push has already introduced these columns, reconcile the migration against an installation/settings snapshot instead of unconditionally setting every store to true; that could overwrite a merchant's explicit opt-out.

## Verification

Server tests: `node --test tests/quick-view/settings.test.mjs`.

Browser tests: install agent-browser and its browser, then run `node tests/quick-view/run-browser.mjs`. Set `AGENT_BROWSER_BIN` to the native CLI executable when it is not on PATH; optionally set `AGENT_BROWSER_EXECUTABLE_PATH` to an existing Chromium binary. The runner starts a localhost-only fixture server, uses an isolated browser session, and closes both on completion. Port 4179 must be available.

The App browser suite covers 28 cases: default and multiple variants, sold out/untracked/continue selling, unavailable combinations, out-of-cap/missing variant images, locale and currency, chart on/off/absent/empty/unsupported/cancellation, product retry/coalescing, cart JSON/non-JSON errors/network/timeout/duplicate submission/success, adapter failure fallback, both entry points, focus trap/restoration (including shadow DOM) and lightbox Escape.

The native suite runs Shopify's actual ModalDialog, QuickAddModal, ProductInfo, VariantSelects and ProductForm code. It tests both modes, native shell creation, one-request opening, native variant/price/SKU/media updates, correct cart payload and error handling, dynamic buttons, focus cleanup, timeout and late-response ownership, wholesale gating, and initial configuration/collection-response reuse. The cart drawer is a fixture double. Source and license are preserved under `tests/quick-view/vendor/dawn`; these files are not shipped in the theme extension. Server tests cover mode persistence, cache invalidation, public data minimization and rate limiting.

Reference: [Shopify Dawn Quick Add source](https://github.com/Shopify/dawn/blob/258f00f64365e2018ca4c62778a6bf55a5d3cd18/assets/quick-add.js) and [native product-card markup](https://github.com/Shopify/dawn/blob/258f00f64365e2018ca4c62778a6bf55a5d3cd18/snippets/card-product.liquid).

Build and targeted ESLint pass. Prisma schema validation passes with a dummy connection URL (validation does not connect); Prisma Client generation passes. Automated App layout checks cover 320x568, 375x667, 430x932 and 1440x900 with long titles and 20 size options. Mobile visual checks at 375x667 and 430x932 confirm scroll access to Add to Cart, sticky close visibility, and no horizontal overflow. The App modal axe audit reports zero violations; it leaves manual contrast checks for patterned sold-out/animated controls. Live store/theme customizations, actual Shopify Markets pricing and a real screen-reader session remain unverified.
