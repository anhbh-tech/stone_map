# Out-of-zone findings from the ps-ui3-admin critique (2026-10-01)

I found these while walking checkout and the admin. They are not fixed here because they belong to another owner. Each owner should copy them into their own critique file.

Screenshots are in `.impeccable/critique/ps-ui3-admin/`.

| ID | Sev | Owner | Where | Repro | Why | Fix proposed |
|---|---|---|---|---|---|---|
| H-01 | **P0** | PDP / personalizer (UI-1) | `src/components/personalizer/Personalizer.tsx:66` `useState(settings.styles[0]?.id)` | Open /products/the-sunflower-queen or /products/the-cafe-terrace-duke. "Pick a style" defaults to **Starry King**. Generate, approve, order. Design DSN-… has the Sunflower product but style `royal-starry`. Cart, checkout, confirmation, email and admin all say "The Sunflower Queen · Style: Starry King" (shop-1440-cart-style-mismatch-before.png). | The customer pays for one theme and gets another, and the designer may paint the wrong theme. | Default the style to the product's own theme and lock or hide the picker on theme products. Optionally, have the server reject a style that does not match on theme products. |
| H-02 | P1 | PDP (UI-1) | Estimated delivery panel | Select 5 × 8×8 ($159.92). The panel still says "Standard $6.99". | Wrong price claim: shipping is free over $79.99. | Use the same free-shipping threshold as the cart. |
| H-03 | P2 | PDP (UI-1) | Buy box | The quantity tier radios and a separate 1–99 Quantity select sit beside each other. | Two controls for one value. | Keep one. |
| H-04 | P2 | PDP (UI-1) | Creation method heading | "Choose Creation Method (If AI fails, upload original photo for designers)". | Long, title-case and alarming. | "How should we make it?" with the designer option explained below. |
| H-05 | P2 | PDP (UI-1) | Upload | The hidden file input is still exposed as a "Choose File" button in the accessibility tree after upload. | Screen-reader noise. | Add `tabIndex=-1` or `aria-hidden` once the photo is set, or wrap it in a label. |
| H-06 | P2 | Shell / settings (UI-1, lead) | Announcement bar | "Order 2 portraits, save 10% automatically" sits beside PEARL2 = 15% on the PDP. | Mixed offers. See the captain question in `ps-ui3-admin.md`. | Align once the captain decides. |
| H-07 | P2 | Lead | `/orders/abc`, any 404 | The default unstyled Next "404: This page could not be found." | Off-brand dead end. | Add `src/app/not-found.tsx` with the store shell and a search link. |
| H-08 | P2 | Account / track order (UI-2) | `/track-order` | The confirmation page and email now send the shopper to `/track-order`, but the form starts empty. | The shopper has to type the number again, and it is printed right above. | Prefill from `?number=` (and `?email=`). Then this crew can link `/track-order?number=1005`. |
| H-09 | P2 | PDP gallery tests (UI-1) | `tests/e2e/ui1-gallery.e2e.ts:178` "finger swipe follows and snaps" | Run this spec alone 3 times: it passed 1/1 on main, then on fm/ps-ui3-admin (no PDP files changed) it failed 2 of 3 runs with `Expected "3 of 3", Received "2 of 3"`. | The swipe gesture test is timing-sensitive, so it flakes in a full run. | Wait for the slide transition to finish (`transitionend` or a poll on `aria-hidden`) before the next swipe. |
