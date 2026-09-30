# Surface: shop browse (/collections, /collections/[handle], /search) and customer account (/account/**, /track-order)

Mode: Operate (the shopper is finding a product or checking an order). Extends the established storefront world; tokens and type come from `src/app/globals.css` (owned by crew UI-1). No new visual identity, no DESIGN.md change.

## Direction contract
THESIS: the shelf shows the art first. Every listing is a wall of pearl portraits with one price per card; filters are plain toggle chips a shopper can read in one glance, not a sidebar of checkboxes. Refuses the stock "hero banner + 4 identical feature cards" collection header.
OWN-WORLD: storefront tokens only (bg-background, bg-card, border-border, text-muted-foreground, accent for price and selected chip); serif display headings, sans body; 1px borders, --radius corners, no shadows beyond the store's shadow-sm; inline Lucide-stroke icons at 1.75px.
STORY: a gift buyer lands on a category (Christmas, Memorial, DIY kits), narrows by theme, type or price, sorts, and opens a product; or types a word and gets live suggestions. A returning customer signs in to see each order's print status and whether their pet's preview is approved.
FIRST VIEWPORT: collection title + one-line description + product count on one row with the sort control; active filter chips under it; the grid starts above the fold at 375 and 1440 (2 columns on phones, 4 at 1440). Account: greeting and the latest order's status line first, addresses after.
FORM: Shopify collection/search/account conventions (PRODUCT.md principle 3), position 1 of 1; no concept-seed roll (precisely specified extension, per new-work.md "Extend an existing surface").
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
