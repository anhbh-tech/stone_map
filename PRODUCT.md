# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- US shoppers buying a personalised pearl portrait of their own pet, usually as a gift (Christmas, birthdays, memorials) or for their own wall. Mostly on phones, arriving from ads or search on a product page.
- The shop operator (admin) who reviews customer photos and AI previews, hands hard cases to a designer, and ships orders.

## Product Purpose
A self-hosted, Shopify-style store for pearl-mosaic pet portraits. The customer uploads a pet photo, sees an AI preview of their pet rebuilt in pearls in the chosen theme (plus a lifestyle scene with the framed piece), picks size and add-ons, and checks out. Success: the customer trusts that the finished piece will look like their pet, and orders without contacting support.

## Positioning
Learns from mogcustom.com (Shopify + a personalisation app) and keeps what works there, while fixing its 12 known problems (see docs/ARCHITECTURE.md): a real preview of the customer's own pet before paying, honest delivery dates, and data-driven reviews.

## Operating Context
- Customer flow: collection or search → product page → theme/variant → upload photo → AI preview (async, with progress) or designer fallback → add-ons, bundles → cart → checkout.
- Customer account: sign in, order history, order and design status.
- Admin: dashboard with orders, designs queue, products/variants/add-ons, reviews, emails, settings, metrics.
- Preview images come from the pearl_compare pipeline (pearl art → lifestyle scene → composited final).

## Capabilities and Constraints
- Next.js 16 App Router, React 19, Tailwind v4, node:sqlite, no ORM. Money in integer cents. Default admin login admin / admin123.
- Must have: search, categories/collections, customer sign in, a Shopify-like storefront.
- Checkout is simulated (local build); no real payment details are collected.
- Undecided: final brand name (working name "Pearl Atelier"), real product photography.

## Brand Commitments
- Personality (confirmed by the owner): a warm, handmade gift shop for pet lovers, not a cold luxury boutique.
- Accent (confirmed by the owner): red, as on mogcustom, for the live price, sale badges, the selected option, and the buy button.
- Price shows once, dynamically, near the title, and updates with the selection; option buttons do not repeat full prices.
- Do not copy mogcustom's logo, images, fonts, or text; mirror layout and behaviour only.

## Evidence on Hand
- Demo art: public/demo/*.webp; seeded catalogue: scripts/seed.ts.
- Reviews: 3 seeded samples, clearly labelled as samples and excluded in production. No real reviews, review counts, or third-party ratings exist; never invent them.

## Product Principles
1. The customer's own pet is the hero: show their preview early and large enough to trust, never fake it.
2. One clear price, always current.
3. Familiar Shopify patterns over novelty in the buying path.
4. Honest claims only: delivery dates, reviews, and stock come from data.

## Accessibility & Inclusion
WCAG 2.2 AA: 4.5:1 text contrast, visible focus, 44px targets, reduced motion respected, layouts at 375/768/1024/1440.
