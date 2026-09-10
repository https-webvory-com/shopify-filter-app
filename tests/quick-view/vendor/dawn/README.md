# Shopify Dawn contract fixtures

These unmodified files come from https://github.com/Shopify/dawn at the commit in
`REVISION.txt`. The original license is included in `LICENSE.md`.

They are used only by the local browser tests, not shipped with the theme extension.
The test page runs the real ModalDialog, QuickAddModal, ProductInfo, VariantSelects,
and ProductForm implementations against synthetic storefront HTML/responses.
The cart drawer and performance instrumentation are fixture doubles. No merchant
product data, cookies, or credentials are included.
