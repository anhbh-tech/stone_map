---
name: Pearl Atelier
description: A warm, handmade gift shop for pearl-mosaic pet portraits, built as a familiar Shopify-style storefront.
colors:
  primary: "#2b1d18"
  on-primary: "#ffffff"
  on-primary-muted: "#d9cdc7"
  secondary: "#5c4a42"
  on-secondary: "#ffffff"
  accent: "#c62a2f"
  on-accent: "#ffffff"
  accent-hover: "#a82126"
  accent-soft: "#fdeceb"
  sale: "#c62a2f"
  background: "#ffffff"
  foreground: "#2b1d18"
  card: "#ffffff"
  card-foreground: "#2b1d18"
  muted: "#f6f2ef"
  muted-foreground: "#6e5f58"
  border: "#e7dfda"
  input: "#9c8c84"
  ring: "#2b1d18"
  destructive: "#b91c1c"
  on-destructive: "#ffffff"
  success: "#15803d"
typography:
  display:
    fontFamily: "Caprasimo, Georgia, serif"
    fontSize: "clamp(3rem, 6vw, 3.75rem)"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.005em"
  headline:
    fontFamily: "Caprasimo, Georgia, serif"
    fontSize: "clamp(1.875rem, 4vw, 2.25rem)"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.005em"
  title:
    fontFamily: "Caprasimo, Georgia, serif"
    fontSize: "clamp(2rem, 5vw, 2.5rem)"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.005em"
  wordmark:
    fontFamily: "Caprasimo, Georgia, serif"
    fontSize: "1.75rem"
    fontWeight: 400
    lineHeight: 1
  price:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1
    fontFeature: "tnum"
  step-heading:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.43
rounded:
  md: "6px"
  lg: "8px"
  radius: "10px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  section: "64px"
components:
  button-buy:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.step-heading}"
    rounded: "{rounded.full}"
    padding: "0 24px"
    height: "52px"
  button-buy-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
  button-buy-disabled:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-foreground}"
  button-ink:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 28px"
    height: "48px"
  button-ink-hover:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-primary}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
    padding: "0 24px"
    height: "48px"
  button-outline-hover:
    backgroundColor: "{colors.muted}"
  icon-button:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    size: "44px"
  icon-button-hover:
    backgroundColor: "{colors.muted}"
  option-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
    height: "48px"
  option-card-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.card-foreground}"
  style-chip:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "44px"
  style-chip-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.card-foreground}"
  badge-sale:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  badge-cart-count:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    height: "20px"
  badge-neutral:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  input-field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  search-field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
    padding: "0 48px 0 16px"
    height: "44px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.lg}"
    padding: "16px"
  announcement-bar:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    height: "40px"
  footer:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary-muted}"
  sticky-buy-bar:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    height: "72px"
---

# Design System: Pearl Atelier

## Overview

**Creative North Star: "The Ribbon on the Box"**

Pearl Atelier is a Shopify store played straight: white product ground, a familiar announcement bar, two-row header, breadcrumb, gallery-left and buy-box-right product page, multi-column ink footer. Nothing in the buying path is novel on purpose. The warmth comes from two places only: a rounded, Cooper-style display face (Caprasimo) for the shop name and headings, and a warm brown-black ink instead of pure black, with warm gray hairlines.

Red is the ribbon on a plain box. It appears in exactly four roles (the live price, the sale badge, the currently selected purchase option, and the buy button) and nowhere else, so a shopper's eye learns within one screen that red means "what it costs, what you chose, where to pay". Everything else, including hovers, the cart count, and marketing calls to action, is ink or neutral.

The world is flat and quiet: soft 10px corners on imagery, 8px on cards and option tiles, full pills on primary actions, no glass, no gradients, shadows only on things that float above the page. It rejects the cream-paper, italic-serif boutique an earlier build drifted toward; this is a gift counter, not a luxury salon.

**Key Characteristics:**
- White ground for product photography, warm ink (#2b1d18 family) for text and chrome.
- One red with one meaning: price, sale, chosen, buy.
- Caprasimo 400 for display, Figtree for every control, number and body line.
- Flat surfaces separated by warm hairlines; shadow only on floating elements.
- 44px minimum touch targets; 48 to 52px on purchase controls.
- Light and dark token sets, switched by `prefers-color-scheme`.

## Colors

A warm neutral palette of ink, paper-white and warm gray, carrying a single ribbon red that functions as a state signal rather than decoration.

### Primary
- **Warm Ink** (primary, foreground, ring): the brown-black used for all body text, headings, the logo, the announcement bar, the footer, the focus ring, the text caret, ink CTAs and the cart count badge. It is the brand's working colour.
- **Cocoa** (secondary): the hover state of ink buttons and of the logo. A lighter step of ink, never a second hue.
- **Ink Mist** (on-primary-muted): secondary text on ink surfaces (footer links, footer blurb, the announcement-bar separator dot).

### Secondary
- **Ribbon Red** (accent): fill of the buy button (Add to cart, Checkout, Place order, and the mobile sticky buy button) and of the "Save N%" sale badge; the border and ring of a selected option; the native `accent-color` of checked checkboxes in the buy flow. White on it is 5.6:1.
- **Ribbon Red, Pressed** (accent-hover): hover of the buy button only. It darkens (7.2:1 with white) rather than lightening.
- **Blush** (accent-soft): the fill behind a selected option tile or chip. Red text on it holds 4.9:1.
- **Price Red** (sale): the colour of the live price text and of the "Save N%" line inside a quantity tile. Identical to Ribbon Red in light mode; lifted to a lighter coral in dark mode so price text stays legible.

### Neutral
- **Product White** (background, card): page ground and card surface. Product imagery sits on white or Linen, never on a tinted paper.
- **Linen** (muted): image placeholders, gallery ground, neutral chips, the text-selection highlight, hover fill for icon buttons and outline buttons, disabled buy button.
- **Driftwood** (muted-foreground): subtitles, legends' secondary text, helper copy, strikethrough compare-at price, delivery prices. 6.1:1 on white.
- **Hairline** (border): decorative dividers: header rules, card outlines, section tops, sticky-bar edges.
- **Pebble** (input): resting border of interactive controls (option tiles, inputs, search, outline buttons) and inactive gallery dots; 3.2:1 on white to meet non-text contrast.
- **Signal Red** (destructive): inline error text and alert icons; lifted to a light coral in dark mode so errors stay legible. **Leaf** (success): the "Verified buyer" mark.

### Dark theme
A full dark set is defined under `@media (prefers-color-scheme: dark)` (guarded by `:root:not([data-theme="light"])`). Ink inverts to a warm off-white (#f5ede9) on a near-black cocoa ground (#1a1311, cards #231a17, muted #2e2420); the buy red shifts to #d33a3f with hover #bf3237 (hover darker, keeping white text at 5.6:1); Blush becomes a deep wine (#3a1c1b); Price Red lifts to coral #ff7b72 (7.3:1 on the dark ground); Signal Red lifts to #f87171 (6.6:1 on the dark ground) with on-destructive turning near-black #1a1311. Components never branch on theme; they only read tokens. The full dark map lives in `.impeccable/design.json` under `extensions.themes.dark`.

### Named Rules
**The Ribbon Rule.** Red means only four things: the live price, the sale badge, the selected purchase option, the buy button. If an element is not one of those four, it is not red: not a heading, a link, an icon, a hover, a cart count, a banner, or a marketing CTA.

**The Ink Hover Rule.** Hovers never introduce red. Icon buttons hover to Linen, option tiles hover to an ink border, ink buttons hover to Cocoa, text links hover to an underline. The only red hover is the buy button darkening to Ribbon Red, Pressed.

**The Two Borders Rule.** Hairline (`border`) is for decoration; Pebble (`input`) is for anything the shopper can press or type into. A control outlined in Hairline has failed contrast.

## Typography

**Display Font:** Caprasimo (with Georgia, serif), self-hosted via next/font, single weight 400.
**Body Font:** Figtree (with system-ui, sans-serif), self-hosted via next/font, variable weight.

**Character:** Caprasimo is round and soft like a strung pearl, giving the shop name and headings a handmade gift-tag voice; Figtree is a plain, friendly grotesque that keeps every control, price and paragraph neutral and legible.

### Hierarchy
- **Display** (Caprasimo 400, 3rem to 3.75rem, 1.15): the home hero headline only.
- **Title** (Caprasimo 400, 2rem mobile / 2.5rem from 640px, 1.25): the product name, the single `<h1>` on the product page.
- **Headline** (Caprasimo 400, 1.875rem / 2.25rem from 768px, 1.15): section headings (Details, Customer reviews, How it works). Balanced wrapping, -0.005em tracking.
- **Wordmark** (Caprasimo 400, up to 1.5rem mobile / 1.75rem desktop, 1): the shop name in the header, drawer and footer. It is a link, never a heading.
- **Price** (Figtree 700, 1.75rem, 1, tabular numerals): the live price beside the title. Compact variant 1.125rem in the sticky bar.
- **Step heading** (Figtree 600, 1.125rem): the buy-box step titles ("Add your pet's photo", "Pick a style", "Estimated delivery"). Buy-box headings deliberately drop the display face.
- **Body** (Figtree 400, 16px, 1.5): all running copy; product details capped at `max-w-prose` (65ch).
- **Label** (Figtree 600, 0.875rem): fieldset legends ("Size:", "Quantity:"), footer column titles, announcement bar (500), nav links (500).
- **Caption** (Figtree 400-600, 0.75rem): counters, badge text, legal line.

### Named Rules
**The One-Weight Display Rule.** Caprasimo ships one weight. `h1`, `h2`, `.font-display` are pinned to 400 with `font-synthesis: none`, so a `font-semibold` on a display heading never fakes bold. Emphasis in display type comes from size, not weight.

**The Figtree-for-Anything-You-Touch Rule.** Buttons, options, inputs, prices, badges and buy-box step headings are always Figtree. Caprasimo never appears on a control or a number.

## Layout

A centred container of 1280px (`max-w-7xl`) with side gutters of 16px, 24px from 640px and 32px from 1024px. Breakpoints are Tailwind defaults (640 / 768 / 1024 / 1280); the design is verified at 375, 768, 1024 and 1440.

**Shell.** An ink announcement bar (min 40px) carries data-driven shipping and bundle copy. From 1024px the header is sticky and two rows: a 72px row (wordmark, centred search up to 576px, account, cart) and a 48px category row. Below 1024px it becomes menu / centred wordmark / account + cart, with full-width search on a second row, and is not sticky (the product page adds its own sticky bars). The footer is an ink block, two columns on mobile, four from 1024px (brand column 1.4fr).

**Product page.** Breadcrumb, then a two-column grid from 1024px: gallery 11fr (about 55%) and buy box 9fr, gap 48px (64px from 1280px). The gallery column is sticky under the header (top 136px) and the main image is square, capped at 70vh. On mobile the gallery is full-width with swipe and dots, and the title and price sit inside the first screen. Details and reviews follow below, separated by a hairline and 64px of space.

**Rhythm.** A 4px base: 8px and 12px gaps inside controls and lists, 16px card padding, 32px between buy-box steps, 64px between page sections, 80px above the footer.

### Named Rules
**The 44 Rule.** Every interactive target is at least 44px tall (`min-h-11` / `size-11`) at touch widths. Purchase controls go larger: option tiles 48px, the sticky buy button 48px, Add to cart 52px. Text links in the breadcrumb and footer relax to 32 to 36px only from 640px, where a pointer is expected.

## Elevation & Depth

Flat by default. Depth is conveyed by warm hairline borders and the Linen ground, not by shadow. Shadows appear only on elements that float above the scroll: the mobile sticky buy bar (an upward shadow tinted from the foreground), the mobile sticky preview bar, the floating help dock and gallery arrows, the slide-in mobile menu, and the framed piece in the preview editor.

### Shadow Vocabulary
- **Float** (`shadow-md`): floating dock buttons and gallery prev/next arrows.
- **Sticky rise** (`0 -4px 16px -8px color-mix(in srgb, var(--foreground) 30%, transparent)`): the mobile buy bar once visible.
- **Drawer** (`shadow-xl`, backdrop ink at 40%): the mobile menu dialog.
- **Rest** (`shadow-sm`): the home hero image and the solid sticky preview bar.

### Named Rules
**The Flat Counter Rule.** Cards, option tiles, delivery and review blocks never cast shadows. If it scrolls with the page, it is outlined, not lifted.

## Shapes

Soft, consistent rounding with three steps plus the pill. The main product image, home imagery and home cards use the 10px house radius; cards, option tiles, delivery and review blocks use 8px; icon buttons, inputs, thumbnails and small editor controls use 6px. Actions that move the shopper forward (buy, checkout, ink CTAs, outline CTAs), the search field, style chips, badges, the cart count and floating dock buttons are full pills. Borders are 1px; a selected tile adds a 1px red ring on top of its red border, and the active gallery thumbnail uses a 2px red border. Icons are inline SVG line icons (Lucide paths) at a 1.75 stroke, round caps and joins, in both the shell and product-page sets.

## Components

### Buttons
Confident pills; colour tells you what the button does.
- **Shape:** full pill (9999px).
- **Buy (Ribbon Red):** Add to cart, the sticky buy button, Checkout and Place order. White Figtree 600, 52px tall full-width in the buy box (1.125rem text), 48px in the sticky bar and cart. Hover darkens to Ribbon Red, Pressed over 150ms. Disabled turns Linen with Driftwood text, never a pale red.
- **Ink:** marketing and non-purchase primary actions ("Create your portrait" on home and in the empty cart, "Generate with AI" in the buy box). Warm Ink fill, white text, 48px. Home and empty-cart CTAs hover to Cocoa; the generate button fades to 90% opacity.
- **Outline:** secondary actions ("How it works"). Pebble border, ink text, 48px, hover fills Linen.
- **Icon button:** 44px square, 6px radius, ink icon, hover fills Linen (menu, account, cart, drawer close, search submit).
- **Focus:** a global 2px Warm Ink outline, offset 2px, on every focusable element.

### Option tiles and chips
The purchase choices: size, quantity, how-to-make-it mode, style, add-ons.
- **Style:** white card, 1px Pebble border, 8px radius (tiles) or full pill (style chips), min 48px (tiles) / 44px (chips), Figtree 600.
- **Hover:** border turns Warm Ink.
- **Selected:** Ribbon Red border, 1px red ring, Blush fill; text stays ink. Driven by `:has(:checked)` on a visually hidden native radio or checkbox, so keyboard focus draws the ink outline on the tile.
- **Content:** tiles never repeat a full price. Quantity tiles may show a "Save N%" line in Price Red; add-ons show only the increment ("+$12" or "Free").
- **Editor toggles** (crop and frame controls in the preview editor) are not purchase options; their pressed state is ink fill, not red.

### Price and sale badge
- **Price:** Figtree 700, 1.75rem, Price Red, tabular numerals, `aria-live="polite"`, rendered once directly under the title and rating and updating with size, quantity and add-ons.
- **Compare-at:** struck through in Driftwood at 1.125rem.
- **Sale badge:** "Save N%" pill, Ribbon Red fill, white Figtree 600 at 0.875rem, only beside the full-size price.

### Cards / Containers
- **Corner Style:** 8px (delivery, reviews, add-ons), 10px on home cards and imagery.
- **Background:** Product White (`card`); notes and sample-review disclaimers use Linen.
- **Shadow Strategy:** none (see The Flat Counter Rule).
- **Border:** 1px Hairline.
- **Internal Padding:** 16px (20px on home review cards).

### Inputs / Fields
- **Style:** white field, 1px Pebble border, 6px radius, 44px tall, 16px text (prevents iOS zoom). Search is a pill with a 44px round submit button inset on the right.
- **Focus:** the global ink outline.
- **Error:** inline Signal Red text with an alert icon beside the field or option that failed.

### Navigation
- **Announcement bar:** ink strip, white Figtree 500 at 0.875rem, centred, separator dot in Ink Mist.
- **Header:** white with a Hairline bottom rule; desktop category links are ink Figtree 500 at 0.875rem, hover underlines (2px decoration, 3px offset). The wordmark hovers to Cocoa.
- **Cart:** bag icon button with a count badge in Warm Ink (20px pill, white 0.75rem semibold), not red.
- **Mobile menu:** a native `<dialog>` sliding from the left, `min(22rem, 88vw)` wide, 48px rows divided by Hairlines.
- **Breadcrumb:** Driftwood 0.875rem with chevrons at 60% opacity; current page in ink.
- **Footer:** ink block, column titles white semibold, links Ink Mist hovering to white with underline.

### Product gallery (signature)
A square main image on Linen, 10px radius, capped at 70vh, CSS scroll-snap track (swipe needs no JS). Prev/next arrows are 44px white-90% circles with Float shadow. From 1024px a strip of 64px thumbnails sits below, the one being viewed outlined in 2px Ribbon Red (it is the selected image); below 1024px, 8px dots, the active one stretched to 20px in ink.

### Mobile sticky buy bar (signature)
Below 1024px, a 72px white bar with a Hairline top edge slides up (200ms ease-out) only when both the price block and the in-page Add to cart button have scrolled out of view, so there are never two buy buttons on screen. It holds the compact price and a red buy pill, respects the safe-area inset, and pushes the floating dock up via `--dock-offset`. A matching 64px solid white sticky preview bar at the top (below 768px, no translucency or blur) shows the customer's own preview thumbnail once it exists.

## Do's and Don'ts

### Do:
- **Do** keep red to its four meanings (price, sale badge, selected purchase option, buy button) and use Warm Ink or neutrals for everything else.
- **Do** show the price once, directly under the title, in Price Red at 1.75rem, and let it update with every selection.
- **Do** outline pressable controls in Pebble (`input`, 3.2:1) and decorative edges in Hairline (`border`).
- **Do** give every target at least 44px at touch widths, and purchase controls 48 to 52px.
- **Do** set Caprasimo only at weight 400 and only on headings and the wordmark; set every control and number in Figtree.
- **Do** read colour from tokens only (`bg-accent`, `text-sale`, `bg-muted`, `border-input`), so the dark set applies without per-component branches.
- **Do** keep the mobile sticky buy bar mutually exclusive with the in-page Add to cart button.
- **Do** honour `prefers-reduced-motion`; motion is limited to 150ms colour transitions and 200ms sticky-bar slides.

### Don't:
- **Don't** use red for hovers, the cart count, links, icons, headings, banners or marketing CTAs; those are ink.
- **Don't** repeat full prices on size or quantity tiles; show only add-on increments or a "Save N%" line.
- **Don't** fake bold Caprasimo or set a control, price or badge in the display face.
- **Don't** use gradients or glass surfaces (no translucent fills, no backdrop blur, sticky bars included), or tint the product ground cream; product imagery sits on white or Linen.
- **Don't** lift cards or option tiles with shadows; shadows belong only to floating elements.
- **Don't** lighten the buy button on hover; it darkens, to keep white text above 4.5:1 in both themes.
- **Don't** show two buy buttons on screen at the same time.
