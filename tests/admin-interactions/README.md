# Admin interaction checks

Run from the repository root:

```sh
node --test tests/search/*.test.mjs
node tests/admin-interactions/run-browser.mjs
```

The browser runner requires `agent-browser` and Chromium. Set `AGENT_BROWSER_BIN` to the CLI binary path and `AGENT_BROWSER_EXECUTABLE_PATH` to your Chromium executable if they are not available by default. Port 4187 must be free.

The fixture server bundles the actual admin React components, strips server-only route exports, and provides sample loader data, action responses, and App Bridge methods. It does not connect to Shopify, the database, or the production app. The runner checks each admin page, clicks initially visible controls (including SVG and div handlers), and tests repaired filter, search, export, date and merge-dialog workflows. Results are written to `scratch/admin-click-results.json`.

These checks verify frontend behavior and submitted data. They do not certify every conditional interaction, live authentication, Shopify custom elements, database persistence, CSV imports, theme installation, billing, or storefront effects. Search scope and filter semantics also have separate Node regression tests.
