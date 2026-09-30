---
version: 1
slug: "src-app-admin"
primary_target: "src/app/admin"
related_targets: []
---

# Admin back office (/admin)

Mode: Operate. The shop operator (and a designer) run the day here: ship paid orders, review customer photos and AI previews, hand hard cases to a designer, moderate reviews, keep catalogue and settings honest. Used on a laptop at a packing desk in daylight, sometimes a phone between tasks.

Constraints: store tokens from globals.css only (owned by UI-1); admin-only CSS lives under src/app/admin. Numbers come from tables (orders, events, designs, reviews); nothing typed in. Login admin / admin123 unchanged. customers/collections tables belong to UI-2 (ui2_001); admin reads them by the shared contract and degrades to an explained empty state when they are absent.

## Direction contract

THESIS: A Shopify-admin canon, pinned by the brief, played straight: the operator should recognise every affordance on sight. Refuses the incumbent "card per fact" dashboard with serif display figures.

OWN-WORLD: Pearl Atelier tokens (stone neutrals, one accent for primary action and selection) with one sans family (Montserrat) for everything, tabular figures in tables and axes. Sidebar on a second neutral layer (muted). Hairline borders, 10px radius, no shadows except the popover.

STORY: Operator opens Home, sees what changed since the prior period and what is waiting (orders to fulfil, designs to review), clicks straight into the filtered list, finishes the task on the detail page (fulfil, approve, assign), and the timeline records it.

FIRST VIEWPORT: Top bar (shop name, sign out). Left sidebar grouped Home / Orders / Designs / Products (Collections, Add-ons, Bundles) / Customers / Discounts / Reviews / Emails, Settings pinned last, with waiting-count badges. Main: H1 "Home" + range tabs (Today, 7, 30, 90 days); one joined KPI strip (Revenue, Orders, AOV, Conversion), each with delta vs the previous equal period; the selected KPI drives the daily line chart directly under it (current solid, previous dashed), then "Needs attention" rows.

FORM: Shopify-admin canon (brief-pinned, no roll; seed key: none — pinned). Signature interaction: KPI strip tabs switch the chart metric; chart crosshair + tooltip with keyboard stepping, table fallback.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
