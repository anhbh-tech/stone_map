---
version: 1
slug: "src-app-store-products-handle-page-tsx"
primary_target: "src/app/(store)/products/[handle]/page.tsx"
related_targets: ["src/app/(store)/layout.tsx"]
---

# Storefront shell + product page

Scope: store shell (announcement bar, header, breadcrumb, footer, mobile sticky add-to-cart) and the product page. Mode: Persuade, inside a buying path that must stay familiar.

Audience/job: US pet owners on phones, usually buying a gift, arriving from ads on the product page. They must trust the preview will look like their pet, see one current price, and reach "Add to cart" without hunting.
Constraints: PRODUCT.md brand commitments (red accent for price, sale badge, selected option, buy button; price once near the title, option buttons without full prices); honest data only (reviews, delivery, shipping from settings); no copied mogcustom assets; no image generation on this machine, so the build is code-led.

## Direction contract
THESIS: A Shopify store played straight (the brief pins the category standard), made warm by type and by a red used strictly as a state signal. Refuses the cream-paper, italic-serif boutique the old build drifted toward.
OWN-WORLD: White product ground, warm brown-black ink, warm gray hairlines, one ribbon red that only ever means "price / sale / chosen / buy". Rounded Cooper-style display face (Caprasimo) for the shop name and headings, Figtree for every control and body line. Soft 10px corners, no glass, no gradients.
STORY: The visitor sees their kind of pet in pearls, reads one red price beside the title, taps a size and watches that price change, uploads a photo, approves the preview, buys.
FIRST VIEWPORT: Desktop 1440: announcement bar, two-row header (logo, search, account, cart; categories), breadcrumb; gallery column about 55% with a square main image capped at 70vh and a 64px thumbnail strip; right column title, rating, red price with strike and save badge, then the size row. Mobile 375: bar, compact header with search, full-width swipe gallery with dots, title and price inside the first screen; a bottom add-to-cart bar once the buy box scrolls away.
FORM: Canon (brief-pinned standing exit), outside the ordered list; seed key 1b03a2bf, challengers declined. Raise kept from the declined spy-dossier challenger: its single alarm red reserved for one meaning, so red never decorates.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
