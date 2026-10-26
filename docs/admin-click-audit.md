# Deep live audit — 26 October 2026, extension 416

This is the latest audit of `collection-filter-pro.myshopify.com`, against source HEAD `187ff63`. The storefront loaded extension **416**; the deployment workflow for that commit reported success. This was a live admin/storefront audit, with reversible app-setting changes and temporary records. It is **not a complete pass** or a certification of every possible input combination.

The audit used two separately created tabs. Existing user tabs, merchant products, inventory, original merchandising/pinning rules, theme files and SoBooster were preserved. No code was deployed during the audit. Earlier fixture counts and historical findings below describe earlier checks, not a fresh regression run on this release.

## Reproduced live findings

| Priority | Finding | Evidence and reproduction |
| --- | --- | --- |
| High | Saving a disabled collection pin re-enables it. | Created a uniquely named temporary rule, disabled it, opened its editor and saved without changing its targeting. Its status returned to enabled. The temporary rule was deleted. `scratch/deep-live-pin-status-final.log`; backend unconditionally sets `status: true` in `app/routes/app.collections.pinning.$id.jsx:106`. |
| Medium | A completely empty new collection pin can be saved. | Opened a new Collection Pinning rule and pressed Save without choosing a collection or product. An empty rule was persisted. The corresponding Search Pinning workflow correctly blocks empty saves. Audit-created empty rules were removed, and the original four collection rules were verified afterward. `scratch/deep-live-editor-edges.log`, `scratch/deep-live-pin-cleanup-confirmed.log`. Editing an existing rule to clear its pins should be considered separately from validating a blank new rule. |
| High, market limitation | The in-stock filter does not establish current-market purchasability. | With the in-stock switch **on** in India, all 59 displayed products were checked against their native Shopify product `.js` responses; 58 were unavailable in that market. A separate browser context and native localization form confirmed the first variant of `dylan-davids-dd1244-black-6-sale` is available in the US at $29.00, unavailable in India at INR 2,900.00. This distinguishes market eligibility from global stock; it is not evidence that the saved switch was stale. `scratch/deep-live-store-corrected.log`, `scratch/deep-live-markets-corrected.json`. A fix must preserve consistent market-specific ordering, facets, counts and pagination; hiding individual cards in the browser would not satisfy that contract. |
| Medium | Escape does not close the filter drawer. | The mobile off-canvas drawer opened but remained open after native Escape key events. A final desktop check focused its close control and reproduced the same behavior. Quick View did close with native Escape. `scratch/deep-live-filter-settings-corrected.log`, `scratch/deep-live-final-ui.json`; the handler in `collectionFilterPro.js` closes filter popovers but not the drawer. |
| Low | The Filters button remains when all groups are disabled. | Turning the default group off correctly removed all filter options and retained 25 product cards, but the visible Filters button opened an empty panel. `scratch/deep-live-filter-groups-final.log`. |
| Incomplete feature | Upgrade buttons do not start Shopify billing. | Clicking Upgrade to Growth produced the alert “Upgrading to Growth plan...” and stayed on the upgrade page. No charge or billing approval was initiated. `scratch/deep-live-editor-edges.log`. |

The collection-pin editor also announces success immediately after submitting its save request (`app/routes/app.collections.pinning.$id.jsx:524`), before server confirmation. A forced production write failure was not introduced to test that message.

## Source-only risks; no cross-store mutation attempted

| Priority | Finding | Scope |
| --- | --- | --- |
| High | Several filter mutations do not scope the supplied record ID to the authenticated shop or verified parent group. | Group delete/toggle/duplicate in `app.filters.groups._index.jsx`; merged-value update/delete/toggle in `app.filters.merged-value.jsx`; individual filter update/toggle/delete/duplicate/reorder in `app.filters.groups.$id.jsx`. The group editor validates its parent group, but these child writes still use the separately supplied filter ID. These are missing ownership checks found in code, not a demonstrated attack against another merchant. |
| High | Synonym saves replace the dictionary on the shared products index. | `synonyms.server.js` reads one shop’s active synonyms, then calls `index("products").updateSynonyms(synonymDict)`. The index is shared across shops. Live synonym writes were excluded from this audit because they could affect stores outside the authorized target. Index-task completion does not address tenant isolation. |
| Incomplete feature | Filter-group Favorites has no implementation. | The list explicitly returns no matching groups for the Favorites view (`app.filters.groups._index.jsx:566`), with a “not implemented yet” comment. |

## Live coverage that passed

| Area | Observed behavior |
| --- | --- |
| Admin navigation | All **24 main routes** loaded without an application error, including both pin editors, both merchandising pages, settings, customization, theme setup and upgrade. Navigation coverage does not imply every control on a page passed. |
| Collection pagination | **25 → 50 → 59** cards; no duplicate product links; first-page order and the first card’s DOM node retained; Load more disappeared at the end. |
| Sorting | Best selling, Trending, price ascending, price descending and newest sorts completed with 25-card first pages and updated URL state. Full independent comparator certification was not performed. |
| Filters | Product Type, Collection and Color selections changed results; Clear restored the total; an impossible Color URL showed an empty state; a shared Black-filter URL preserved selection and product order on reload. The independent India variant-availability check exposed the market limitation above, so it is not counted as a same-variant availability pass. |
| Group and individual switches | Group off removed its options; Color off removed Color while Size and 25 product cards remained; original states were restored. |
| Filter settings/layouts | Product-count labels appeared; breadcrumbs, one-item options and unavailable-variant flags persisted; Vertical Sidebar placed the sidebar beside the grid; Horizontal Toolbar displayed filter pills; mobile horizontal scrolling displayed its headings without grid overflow. Mobile off-canvas opened; Escape closing failed as noted above. |
| General settings | Hover images disappeared when disabled; collection Quick View rendered 25 buttons when enabled; the instant Quick View flag persisted; wholesale mode hid logged-out card prices. Original audit changes were restored. |
| Search Settings | Below-minimum and above-maximum numbers were rejected; page size 4 produced four cards, vendor labels and the search input could be hidden, and collections retained 25 cards. Restore defaults produced a 25-card search page. |
| Immediate next-action updates | On the **same open storefront document**, saving product limit 3 and minimum characters 3 hid a two-character query and returned three products for `dress`. Resetting settings returned six products on the next search without reloading. Original settings were restored. |
| Redirects | Required fields, unsafe protocols, protocol-relative URLs, search-loop destinations and 51 queries were rejected. Creation normalized case/whitespace, duplicate queries were rejected, a real submitted search redirected, editing and enable/disable applied, and cancelling deletion preserved the rule. Temporary rule removed. |
| Banners | Required fields and unsafe links were rejected. A temporary text/grid banner appeared on its real targeted search and disappeared after disabling. Temporary banner removed. |
| Suggestion blacklist | Exact matching preserved an unrelated suggestion; Contains suppressed both matching suggestions; disabling restored them; cancelling deletion preserved the rule. Temporary blacklist and manual suggestions removed. |
| Existing collection pins | The three Formal pins matched the storefront prefix. The first pinned card’s first-original-variant link and first-product-gallery image were independently compared with Shopify. The original rule was not saved or reordered. |
| Search pin editor | Empty save was blocked; nonexistent product title and malformed ID searches were empty; Title/Tag/ID choices were available; Cancel returned to the list. |
| Merchandising editors | Blank creation was blocked in both editors; Cancel preserved the saved rule lists. Existing rules and schedules were not changed. |
| Merged Values | Add dialog opened with its fields; Cancel preserved the saved rows. New live merge-rule persistence was not certified in this pass. |
| Customization validation | Invalid JavaScript was rejected with a syntax error before publication. The final public configuration retained empty CSS, disabled JavaScript and the original Navy Blue swatch. Positive CSS/JavaScript publication and swatch CRUD were not completed reliably by this audit driver and are not counted as passes or product defects. |
| Quick View | The final check opened a real instant-search product dialog, loaded its product image and closed it with native Escape. Pointer hit-testing did not establish an unobstructed mouse click, so activation used the DOM button fallback. No add-to-cart or checkout write was performed. |

## Cleanup and final state

Final authenticated list visits and a fresh storefront load verified no audit-prefix records remained. The original counts were four collection pin rules, five search pin rules, one filter group, three redirects, two banners, no blacklist rules, three synonyms and three merged-value rows. Final Search Settings were product limit 6, suggestion limit 10, collection limit 5, recent limit 4, minimum characters 2, page size 40, the four search display flags enabled and no manual suggestions.

The tested filter settings were explicitly restored and checked after an audit-driver recovery: Drawer on desktop, Horizontal scrolling on mobile, breadcrumbs enabled, one-item options/count labels/unavailable-variant hiding disabled. General display changes were restored. The final public customization had empty CSS, JavaScript disabled, and Navy Blue `#80c7ea`; no audit CSS, JavaScript or swatch marker remained.

Changes observed outside the audit’s steps were preserved: the final storefront was in the **US** market and **Show only in-stock products was off**. The India availability finding was recorded earlier while that switch was on. The two audit-created tabs were closed; existing user tabs were retained.

Final evidence: `scratch/deep-live-final-verification.json`, `scratch/deep-live-final-ui.json`, `scratch/deep-live-filter-restore.log`, `scratch/deep-live-pin-status-final.log`, `scratch/deep-live-audit-state.json`. These ignored local artifacts include both successful checks and superseded driver attempts; raw failed-attempt counts are not product-defect counts. Early attempts had hydration/input timing, viewport-session and browser-connection problems and were repeated where noted.

## Remaining verification limits

- Theme Setup reported **Unable to verify** for Prestige, Release, Symmetry, Impulse, Pipeline and Motion. Installation/reversion and merchant theme-file changes were not attempted.
- Native CSV file-picker interaction, complete multi-batch live imports, every rule/schedule combination, full pin drag/drop persistence, a fresh full synchronization, external Wishlist Growth writes, paid billing, cart writes and checkout were not certified.
- Synonym CRUD and cross-shop authorization tests were not executed against other merchants. The source risks above need correction and isolated tenant tests.
- This was not a cold-load performance acceptance test. No merchant caches were manually cleared, and no two-second cold-load guarantee is established.

# Admin audit — 26 October 2026

Checked local HEAD `a9e518b` and the deployed app on `collection-filter-pro.myshopify.com`. Wishlist was excluded at the user's request. Live checks used newly opened tabs and reversible app settings; existing user tabs, products, pinning rules, merchandising rules and theme files were preserved. No code was deployed.

## Current validation

- 828 regression tests passed, with no failures, skips or cancellations.
- Production build passed.
- Actual React admin fixtures passed 25 page renders, 227 click smoke checks and 10 targeted workflows. Fixtures use sample loaders/actions rather than Shopify persistence.
- Search Settings passed isolated PostgreSQL checks and 12 browser workflows; Customization passed isolated PostgreSQL checks and 11 browser workflows.
- Redirects passed isolated PostgreSQL and browser checks, including create, edit, enable/disable, duplicate rejection, unsafe URL rejection, storefront redirects and delete.
- Updated stale audit fixtures to supply redirects and a selected customization theme. Export workflows now select their intended rule independently of sorting and use the current Export label. Redirect deletion asserts the current empty state. These are test changes, not production fixes.

## Live settings changes and storefront verification

| Setting | Temporary change and observed result |
| --- | --- |
| Search page size | 40 → 4 produced four complete cards and a 4-of-59 count. Restoring 40 produced 40 complete cards. Collection pages retained 25 cards. |
| Search vendors | Disabling vendor names removed vendor labels; restoring enabled displayed 40 vendor labels on 40 search cards. |
| Search input | Disabling set the results-page form to hidden; restoring made it visible. |
| Instant-search product limit | 6 → 3 produced three instant-search product cards. |
| Suggestions | A temporary manual suggestion appeared on the storefront and was removed afterward. Zero suggestion/collection/recent limits hid their sections after loading. |
| Minimum search characters | With a minimum of three, the two-character query `dr` displayed no instant-search product results; `dress` displayed six. |
| Sale/sold-out labels | Disabled settings reached the real storefront; sale badges were absent. No independent sold-out product comparison was performed. |
| General display settings | In-stock, hover-image, instant Quick View and collection Quick View changes persisted into storefront global settings. Collection Quick View added 25 buttons and opened the product dialog; disabling hover removed secondary image elements. Stock eligibility was not independently compared product by product. |
| Wholesale | Logged-out cards hid prices when enabled. Restored to disabled. |
| Desktop layouts | Vertical Sidebar placed filters beside products; Horizontal Toolbar produced five filter pills. Restored Drawer. |
| Product counts | Enabling displayed option counts, including Product Type counts. Restored disabled. |
| Mobile layouts | At approximately 390px, Off-canvas showed a Filters button that opened the drawer. Horizontal scrolling displayed the filter headings in a row. Restored Horizontal scrolling. |
| Custom CSS | A temporary three-pixel green outline appeared on real product cards. Restored the original empty stylesheet; final reload had no temporary CSS. Original swatches were retained. |

Final public API reads and a real storefront reload confirmed restoration of all changed values, including the empty manual-suggestions list and CSS. Database updated-at timestamps changed as expected. Evidence: `scratch/admin-live-settings-audit-20261026.json`, `scratch/admin-audit-browser-20261026.json` and `scratch/admin-audit-*-20261026.log`.

Live navigation also loaded Filter Groups, the existing default-group editor, Merged Values, Synonyms, Redirects, Blacklist, Banners, both pinning lists, the new search-pin editor and both merchandising lists. The direct `/filters/groups/new` URL returned 404; actual group creation uses the list dialog, and the existing default-group editor opened successfully.

## Outstanding limits and findings

- Upgrade buttons remain alert placeholders rather than a Shopify billing flow. Filter-group Favorites remains unimplemented in source.
- Theme Setup reports Unable to verify for several themes. No theme installation, reversion or theme-file changes were performed.
- This is not exhaustive live CRUD certification of every rule, CSV batch, scheduling combination, filter type or external integration. Sort priority, stock membership, unavailable-variant filtering and scrolling have regression coverage, but were not all proved with new independent live comparisons.
- Search loading showed skeletons while requests completed. This audit did not establish a cold-load performance SLA.

## Historical audit — 23 September 2026

The admin interface was reviewed across Dashboard, Filters, Search, Collections, and Settings. This is a local code and browser audit, not a certification of the deployed Shopify app.

Final validation passed: **25 page renders, 204 click smoke checks, 10 targeted browser workflows, 12 Node regression tests, and the production build**. See the [browser results](../scratch/admin-click-results.json).

## Coverage

- Initial source inventory: 71 route/component files and 504 click handlers.
- Browser fixtures load the actual React components for 25 admin screens.
- 204 initially visible controls are exercised, including buttons, checkboxes, links, and div/SVG click handlers.
- Targeted browser workflows check filter application and cancellation, both pin-editor Search buttons, both merchandising date dialogs, selected-rule CSV export, all-search editor scope, search-pin CSV fields, and the Merged Values add dialog.
- Node regressions cover loader failures/authentication responses, filter semantics, saved pin scope/status, query-specific versus all-search matching, legacy search-page targeting, and CSV import/export data.

Browser actions use sample loaders/actions and an App Bridge stub. A successful smoke check means the click did not throw or navigate to an unknown local route; targeted tests separately assert the resulting behavior. Every conditional state and every possible input combination has **not** been exercised.

## Fixed

| Area | Problem | Result |
| --- | --- | --- |
| Product Pinning | Unused collection API requests could prevent the list/editor from loading. | Removed those requests; preserved Shopify response headers. |
| Search Merchandising | A failed collection/location lookup prevented access to saved rules. | Shows a warning while retaining the rules; authentication responses still propagate. |
| Search and Collection Pinning | Applying the Filter dialog did not filter the list. | Active, item-name, and target filters now apply with all/any matching. |
| Search rule filtering | Dialog offered Collections while the search page expected Search Queries. | Search pages offer Search Queries. |
| Filter cancellation | Editing a filter could mutate the applied filter before pressing OK. | Dialog edits use independent objects; Cancel retains the applied filter. |
| Pin editors | Search buttons had no click handlers. | Clicking Search submits a product search and resets pagination. |
| All-search pins | The create dialog's all-search choice was lost, and the search service ignored these rules. | Choice loads/saves correctly; a query-specific rule takes precedence over the applicable all-search fallback. |
| Pin editing | Saving an existing disabled search pin enabled it. | Editing preserves the existing status. |
| Search merchandising export | Selected rule objects were passed where IDs were expected, producing an empty CSV. | Exports selected rules and marks them as search rules. |
| Merchandising dates | Static calendars showed hardcoded dates and nonfunctional navigation/select controls. | Native date fields support date selection, validation, clearing, and cancellation. |
| Search-pin CSV | Only one search query was retained; all-search scope was missing; imported search-page pins used an incompatible target value. | Extra queries and all-search scope round-trip; legacy CSVs/target values remain supported. |
| Search merchandising import | Successful imports lacked the expected completion toast. | Shows the imported rule count. |
| Merged Values | The create action was labeled “Merge values.” | Both entry buttons say “Add merge value.” |

## Remaining limits and unfinished features

- **Live Shopify testing remains necessary.** These checks do not verify live authentication, Shopify-hosted web components, API permissions, database persistence, theme-editor actions, synchronization jobs, or storefront ranking after a save. The original production turbo-stream error has not been reproduced in an authenticated store session.
- **Customization is marked Coming Soon.** Its direct route still contains a placeholder Save Customization button with no persistence. It is not an available feature.
- **Billing is unfinished.** The Upgrade route is absent from app navigation; its upgrade buttons only display an alert and do not start Shopify billing.
- Other Search cards labeled Coming Soon are intentionally inactive.
- An unused legacy add-filter modal contains undefined handler references. The reachable Add filter action opens the separate `CreateFilterModal`; the legacy block is never enabled by the current UI and was left unchanged.
- Native file-picker interaction and a full multi-batch CSV upload were not performed. The CSV mapping and batch-save payload have regression coverage using a mocked database.

## Re-run

See [browser test instructions](../tests/admin-interactions/README.md). The browser runner writes its results to `scratch/admin-click-results.json`. Node tests are in `tests/search/`. Run `npm run build` for the production build check.

No changes were deployed, and no production store records were changed during this audit.
