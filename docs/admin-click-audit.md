# Admin click audit — 23 September 2026

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
