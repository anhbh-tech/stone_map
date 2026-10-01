# Critique — UI-2: search, collections, account, order lookup, mobile menu, basic SEO

Reviewer: crew UI-2 (ps-ui2-account), 2026-10-01. Fresh context, played a first-time US gift buyer on a phone and on a laptop.

- **Build:** `main` at defbb62, `npm run seed` plus `npm run load:rollout -- --dir …/pc-v2-template-cutout/rollout`, so the three theme products show their passing rollout finals. :3000 was down, so this ran on my own dev server on :3112 with a scratch DB.
- **Tools:** Playwright at 375×812 (touch) and 1440×900. chrome-devtools-axi could not launch because Chrome is not installed on this machine. Impeccable `detect` ran on the zone's files and found 0 issues.
- **Screenshots:** `.impeccable/critique/ui2-account/` (`before-<route>-375|1440.jpg`, `before-flow-NN-*-375.jpg`).
- **Method note:** this was a single-context run. Impeccable's critique asks for two isolated sub-agents. I skipped that because the captain's format (P0/P1/P2 table and 1–10 scores) is the deliverable and both checks used the same live session.

## Scores (1–10)

| Dimension | Score | Why |
|---|---|---|
| Trust | 6 | Account, order status and track-order are honest and clear: the steps, "Preview approved" and the delivery window all come from data. Demo products and their badges are labelled. Trust drops for three reasons: a "Royal Cat Portrait" that shows a dog, collection covers that don't match the occasion (a crowned "royal" dog for Memorial), and a bare unbranded 404. |
| Clarity | 7 | Search, filters, sort, empty states and the order progress read well. Gaps: no way to recover a forgotten password, Track order isn't in the menu, and an unknown collection URL silently becomes "All products". |
| Aesthetics | 7 | Follows DESIGN.md: ink, one red, Caprasimo headings, pills. The mobile collections index is six screen-tall cards in a row. The 404 is the default Next page. |
| Perceived speed | 7 | Pages render in about 0.6–0.9 s on the dev server. Suggestions are debounced and cached. On the first keystrokes the list shows only the "Search for…" row, then the products push in above it. |
| Mobile | 6 | No horizontal scroll on any route. Targets are ≥44 px in my zone. The menu works, but it is half empty and has no Track order or account entry. /collections makes you scroll about 6 screens before you reach a product. /search shows two search fields. |

Against Shopify and mogcustom (layout and behaviour only): both put **Track order** in the main nav, and both offer **Forgot password** on login. Shopify serves a branded 404 inside the store shell, returns a real 404 for unknown collections, and lays out the collection list as compact tiles on mobile. We match them on search suggestions, the filter drawer, sort and pagination.

## P0: broken / blocks buying

None found. All of these worked end to end at 375 and 1440:
- menu → collection
- header search (Enter, the icon button, and a suggestion with ↓ Enter)
- register → checkout signed in → the order shows under /account with its design status
- track order (`#1001` + an email in a different case)
- sign out
- wrong password gives an error

## P1: hard to use, wrong, or clearly ugly (fix now, my zone)

| # | Where | Repro | Shot | Why it matters | Fix |
|---|---|---|---|---|---|
| 1 | 404 for unknown URLs | Open `/no-such-page` | `before-no_such_page-375.jpg`, `-1440.jpg` | Next's default black-on-white "404 \| This page could not be found." No header, footer, search or links, and the title is just "Pearl Atelier". An old ad link or a typo is a dead end. | Branded not-found inside the store shell: search box, collection links, Track order, home. Proper title. Keep the 404 status and noindex. |
| 2 | 404 for a missing product | `/products/no-such` | `products_no_such-375.jpg` | It has the shell, but the body is the default Next block and the title is "404: This page could not be found." | Same branded not-found (from `(store)/not-found.tsx`). |
| 3 | Unknown collection | `/collections/nope` | `collections_nope-375.jpg` | Redirects to `/collections/all` with **200**. That is a soft-404 for search engines, and a shopper following a dead link sees "All products" with no explanation. | `notFound()`, which gives a real 404 and the branded page with the collection list. |
| 4 | Login: no password recovery | `/account/login` | `account_login-1440.jpg` | A returning customer who forgot their password has no way in. Every Shopify store has "Forgot your password?". | "Forgot password?" → email form → one-time reset link (the simulated mailer, visible in /admin/emails) → set a new password. The reply is the same whether or not the account exists (no account enumeration). The link expires in 1 h and works once. |
| 5 | Track order not in the menu | Open the mobile menu, or the 1440 nav row | `flow-01-menu-375.jpg`, `home-1440.jpg` | Gift buyers come back to ask "where is it?". Today Track order is reachable only from the footer and the login page. mogcustom has it in the top nav. | Add a "Track order" entry to `CategoryMenu` (both desktop and mobile). |
| 6 | /collections on mobile | `/collections` at 375 | `collections-375.jpg` | There are 6 collections, each a full-width 4:3 image with a big heading, so you scroll about 3,000 px before reaching "All products". The same three demo images repeat. | Below 640 px, a 2-column tile grid (square image, title, count) and a shorter description. 640 px and up stays as it is. |
| 7 | Demo product says "cat", shows a dog | `/search?q=cat`: the first result is "Royal Cat Portrait" with a Shiba image | `search_q_cat-375.jpg` | The picture contradicts the name, on exactly the trust point the product promises ("looks like *your* pet"). | Rename the demo seed to "Royal Robe Pet Portrait" (pet-neutral), keeping the cat/dog tags. Real cat art comes from the rollout products. |

## P2: polish (my zone, cheap ones fixed where noted)

| # | Where | Repro / shot | Why | Proposal |
|---|---|---|---|---|
| 8 | Search suggestions while loading | Type "sunf" fast: at first only "Search for 'sunf'" shows, then 2 products insert above it (`flow-02-suggest-375.jpg`) | The row you are about to tap moves (layout shift, wrong tap) | Reserve skeleton rows while the first result loads. **Fixed.** |
| 9 | Wrong password | `before-flow-09-login-wrong-375.jpg` | First read: focus stayed put and an empty second alert was announced. | **Not reproduced on re-check.** Focus does move to the error alert. The empty `role=alert` node is Next's route announcer. No change. |
| 10 | "xmas" finds nothing | `/search?q=xmas` | A common shorthand misses the Christmas collection | Small synonym map (xmas→christmas, kitty→cat, puppy→dog). **Fixed.** |
| 11 | /search on mobile shows two search fields | `search-375.jpg` | Header field plus page field. Redundant, and they push results down. | Hide the header field on /search, or drop the page one below lg. The header belongs to UI-1, so this is left for now. |
| 12 | Suggestions show no price | `flow-02-suggest-375.jpg` | Shopify's predictive search shows the price | Add "From $X" to the suggest API and rows. |
| 13 | Collection covers don't match the occasion | Memorial's cover is a crowned "royal" dog; Christmas covers are sunflower and café scenes (`collections-1440.jpg`) | Tone is wrong for memorial | Needs real themed art. Captain's call: until it exists, use a neutral cover (no image) for Memorial. |
| 14 | 8 demo products recycle 3 images | Every listing | Pads the catalogue. The badges are honest, but the grid looks repetitive. | Captain decision: keep the demos for now, or hide them once real products exist. |

## From UI-1's critique (`docs/critique/ui2-account.from-ui1.md`)

| # | Item | Outcome |
|---|---|---|
| 15 (P1) | `/search?q=dog` put 7 "Demo" products above the 3 real theme products. The same ordering pushed the real products off the "All products" grid on /collections, which shows only the first 12. | **Fixed.** The "Featured" and "Best match" sorts now put non-demo products first, and demos only fill in after them (`src/lib/listing.ts`). Unit test added. |
| 16 (P2) | The header SearchBox measured 42 px | **No change.** The control is 44 px (`h-11`). The 42 px is the `<input>` inside its 1 px border, and the whole pill plus the 44 px submit button are the tap area. |

## Out of my zone, handed to the owners (not fixed here)

| Owner | # | Where | Issue | Proposal |
|---|---|---|---|---|
| Checkout (crew D / UI-1) | H1 (P1) | `/checkout` while signed in | Email, name and address are **not prefilled**. "Signed in as …" is shown, yet the customer retypes everything, and could even type a different email. | `CheckoutForm` takes `initial` values. The checkout page passes `currentCustomer()` email and name plus the default address from `customer_addresses`. UI-2 can supply a `checkoutDefaults()` helper in `src/lib/account.ts`. |
| Shell (UI-1) | H2 (P2) | Footer › Account | Shows "Sign in" while signed in | Render `AccountLink`-style state, or "My account". |
| Shell (UI-1) | H3 (P2) | Header on `/search` (mobile) | Duplicate search field (see #11) | Hide the header SearchBox when `pathname === '/search'`. |
| Orders page (crew D) | H4 (P2) | `/orders/<n>` on another device | "Only shown on the device that placed the order", with no link onward | Link to `/track-order?number=<n>` and to sign-in. |
| Lead (`seo.ts`, `layout.tsx`) | H5 (P2) | All pages | No Open Graph or Twitter tags: shared links show no image or title card | Add `openGraph` defaults (site name, image) in the root metadata. |
| UI-1 (MobileMenu) | H6 (P2) | Mobile drawer | Below the links, about 60% of the drawer is empty. No account entry. | Put Sign in / My account at the bottom of the drawer. |
| Lead (`playwright.config.ts`) | H7 (P1, dev) | e2e harness | The e2e DB and storage live at the fixed `os.tmpdir()/pearl-e2e`, and the web server runs `rm -rf` on it at start. Concurrent `npm run test:e2e` in parallel worktrees wipe each other's DB, which gave me 13 false failures. | Default to a per-run `mkdtemp`, or key the path on the worktree. Workaround: `TMPDIR=$(mktemp -d /tmp/x.XXXX) npm run test:e2e` (keep it short, because tsx's IPC socket path has a length limit). |

## Fixed in this pass

| # | Change | Files | After |
|---|---|---|---|
| 1–3 | Branded 404 inside the store shell: search, collection list, Track order, Back to the shop. Unknown URLs, missing products and unknown collections now return a real **404** titled "Page not found \| Pearl Atelier". The collection soft-404 redirect is gone. | `src/components/nav/NotFoundView.tsx`, `src/app/(store)/not-found.tsx`, `src/app/(store)/[...missing]/page.tsx`, `collections/[handle]/page.tsx` | `after-no_such_page-*`, `after-products_no_such-*`, `after-collections_nope-*` |
| 4 | Forgot password. Login shows "Forgot password?" → `/account/forgot`, which always gives the same answer (no account enumeration). Real accounts get a one-time 1-hour link in the simulated outbox (`kind = password_reset`), capped at 3 per hour per account and 10 per 15 min per IP. The link points at `SITE_URL`, not the request Host. `/account/reset` sets the new password, signs the customer in and signs out every other session. Account forms post with `method="post"`, so a submit before hydration can't put a password in the URL. | `db/migrations/ui2_002_password_resets.sql`, `src/lib/customer.ts`, `src/app/api/account/{forgot,reset}`, `src/app/(store)/account/{forgot,reset}`, `src/components/account/{PasswordReset,AuthForm}.tsx` | `after-account_login-*`, `after-account_forgot-*` |
| 5 | "Track order" in the desktop nav row and the mobile menu | `src/components/nav/CategoryMenu.tsx` | `after-home-nav-1440.jpg`, `after-flow-01-menu-375.jpg` |
| 6 | /collections below 640 px is a 2-column tile grid. Page height at 375 drops from 5,712 to 4,063 px, and the collections take about 1.5 screens instead of 6. | `src/app/(store)/collections/page.tsx` | `after-collections-375.jpg` |
| 7 | The demo "Royal Cat Portrait" is now "Royal Robe Pet Portrait", so the name matches its dog image. The handle is unchanged. | `scripts/seed-collections.ts` | `after-search_q_cat-375.jpg` |
| 8 | Two skeleton rows reserve space while the first suggestions load, so "Search for …" no longer jumps | `src/components/nav/SearchBox.tsx` | `after-flow-02-suggest-loading-375.jpg` |
| 10 | Shorthand synonyms (xmas, kitty/kitten, puppy/pup/doggy) are OR-ed with the typed word | `src/lib/listing.ts` | `after-search_q_xmas-*` |

**Tests:** new vitest cases cover reset (single use, expiry, throttle, other sessions signed out) and synonyms. New e2e cases cover the 404 pages and status, forgot → reset → sign in, single-use link, Track order in both menus, the 2-column /collections at 375, and `xmas`.

**Left for the captain:** #11–#14 and H1–H6.

**Mockup-first:** not done. No image-generation tool was available, so the fixes went straight to code within the existing DESIGN.md system: no new colours, fonts or layouts. The /collections mobile grid reuses the existing tile pattern.
