# Agent Allowance brand review

PR #16, branch `cursor/judge-review-fixes-42a9`, commit `c97dbd9`. Reviewed 25 October 2026.

Independent review of the logo mark, wordmarks, app icon, and favicon in `dashboard/public/brand/`, of `docs/BRAND.md` and `docs/brand-sheet.png` (source `docs/brand-sheet.html`), and of the brand as it is applied in the dashboard header, the loading state, and `README.md`. The bar is a Mastercard or Revolut ship: the work has to hold up as a fintech identity, it has to stay clear of a generated look, text and UI states have to meet WCAG AA, and the mark has to read at 16px.

## Scores

**Brand: 6/10. UI: 7/10.**

The palette and the open-ring idea are ownable, and the light-mode home screen is a credible spending account. A brand studio would keep both and send the asset files back. One 32-unit drawing is copied into the favicon, the app icon, and the header. The wordmark is Outfit outlined by a tracer. Dark mode repaints pine as mint and drops two text colors through AA. That is short of a ship.

## What already holds

The mark is a real drawing, with one center and one thickness.

- Outer arc center `(16.003, 15.401)`, radius `10.40`. Inner arc center `(16.000, 15.401)`, radius `5.80`. The centers agree within `0.003` units. Band thickness is a constant `4.60`.
- The gap is `52.02°`, from about −100° to −48° (top of the ring, roughly 10:30 to 1:30). Both cuts are radial.
- The dot sits on the band midline (radius `8.10` from the same center) at `cx="17.88" cy="7.52" r="2.5"` in `dashboard/public/brand/mark.svg`.
- The ring is shifted up by `0.60` units so the missing top does not make the tile look bottom-heavy. Margins inside the 32 tile: top `5.00`, sides `5.60`, bottom `6.20`.

A Cairo raster of `mark.svg` at 16×16 on white keeps the hole open, keeps a two-pixel cream band, and keeps a 2×2 lime cluster (`#C6F36B` at pixels `(8,3)` and `(9,3)`) two pixels away from the nearest cream pixel. The same separation holds on the page color `#ECE8DE`. At 24px and 32px the top opening and the dot stay separate. The 16px bar is met for structure. The dot is only two pixels wide, which is the fragile part, and it is called out below.

These text pairs pass AA (normal text needs 4.5:1, large text 3:1, UI boundaries 3:1):

| Pair | Contrast |
| --- | --- |
| `#F7F4EC` on `#1B4D3E` | 8.77:1 |
| `#1A1814` on `#F7F4EC` | 16.13:1 |
| `#1A1814` on `#ECE8DE` | 14.49:1 |
| `#1A1814` on `#FFFFFF` | 17.73:1 |
| `#5A534A` on `#FFFFFF` | 7.58:1 |
| `#5A534A` on `#ECE8DE` | 6.19:1 |
| `#C6F36B` on `#1B4D3E` | 7.55:1 |
| `#C6F36B` on `#143D31` | 9.44:1 |
| `#8A4518` on `#F8EFE4` | 6.27:1 |
| `#8E2218` on `#F8E8E4` | 7.38:1 |
| `#0F5C3D` on `#E3F2EA` | 6.93:1 |
| `#E4EFE8` on `#1B4D3E` | 8.18:1 |
| `#143D31` on `#E5F0EA` | 10.33:1 |
| `#F4F0E6` on `#121411` | 16.27:1 |
| `#C9C2B4` on `#121411` | 10.46:1 |
| `#5C564C` on `#E4DDD0` (disabled) | 5.38:1 |

Labels land on the spec in `docs/BRAND.md`. The later rules in `dashboard/src/styles.css` (lines 1424–1433 and 1604–1608) set `.eyebrow` to 13px, weight 600, `letter-spacing: 0`, `text-transform: none`. The earlier uppercase tracking at lines 159–165 is dead. Outfit carries the product name and the balance. Inter carries the UI.

The horizontal wordmark is set, not dumped onto the mark. In `dashboard/public/brand/lockup-horizontal.svg` the mark center is `y=28` and the Outfit cap-height center is `y=28.0`. At a 486px render the gap between tile and name is 14 viewBox units, against a lime-dot diameter of 7.5. In the header, `.brand` gap is `12px` (`styles.css` line 178) against a 6.25px dot at the 40px mark. The sidenav gap of `8px` at a 32px mark clears a 5px dot.

Status pills use the documented pairs: `.pill.warn` is `#8A4518` on `#F8EFE4`, `.pill.ok` is `#0F5C3D` on `#E3F2EA`, `.pill.danger` is `#8E2218` on `#F8E8E4` (`styles.css` lines 1712–1714).

## Must-fix

### 1. Stop copying one SVG into every slot

`mark.svg`, `favicon.svg`, and `app-icon.svg` are the same 337 bytes (sha256 prefix `224a48fe5111`). `dashboard/src/icons.jsx` lines 20–24 paste the same path again in `LogoMark`, and nothing renders `LogoMark`.

The 16px drawing survives, and it is the wrong drawing for a home-screen icon. `app-icon-512.png`, `app-icon-light-512.png`, and `apple-touch-icon.png` all have a transparent corner pixel `(0,0,0,0)` and a pre-rounded tile (`rx="7"` on a 32 viewBox, 21.875% radius) with pine or cream at the mid-edge. iOS masks a squircle of about that radius on top. The shipped icon will look inset, with a fringe of the home-screen color in the corners.

`dashboard/index.html` lines 12–15 also point `rel="icon"` at `app-icon-512.png`, so a browser tab can pull a 512px PNG for a 16px slot.

Fix:

- Keep `rx="7"` on the in-product tile only (`mark.svg`).
- Rebuild `app-icon-512.png` and `apple-touch-icon.png` as full-bleed squares, no transparency, no baked corner. Let the OS mask them. Give the ring at least the current 5-unit margin inside the squircle safe zone.
- Draw `favicon.svg` and `favicon-32.png` as their own 16px art: same top gap, band at least 2px, dot at least 3px across. Raise the dot from `r="2.5"` toward `r="3.2"` and keep pine between the dot and the cream (the closest approach today is `1.11` units, which becomes half a pixel at 16px). The current 2×2 dot is legal and easy to lose on a busy tab strip.
- Delete `LogoMark` or make it the only inline copy, generated from `mark.svg`.

### 2. The light tile is invisible on the product’s own light surfaces

`mark-light.svg` fills the tile with `#F7F4EC`.

| Pair | Contrast |
| --- | --- |
| `#F7F4EC` on `#FFFFFF` | 1.10:1 |
| `#F7F4EC` on `#ECE8DE` | 1.11:1 |

`docs/BRAND.md` lines 41 and 53 specify that file for light surfaces. On the page and on white cards the tile has no edge. What remains is a pine ring and an ink dot, which is a sound mark and a different asset than the one in the file.

`mark-dark.svg` is the honest version of a tile-less mark (cream ring, lime dot, no rect). The dark lockups do not use it. `lockup-horizontal-dark.svg` and `lockup-stacked-dark.svg` still draw the pine tile (`fill="#1B4D3E"`). That tile on `#121411` is **1.92:1**, and on `#1C1F1A` is **1.73:1**. Both fail the 3:1 boundary. On the dark brand-sheet ground the rounded square sinks and the ring looks unmounted.

Fix: remove the `#F7F4EC` rect from `mark-light.svg`. Build the dark lockups from `mark-dark.svg` (no tile) plus the cream wordmark `#F7F4EC`, which is 16.85:1 on `#121411`. Update the table in `docs/BRAND.md` lines 41–46 so it matches.

### 3. README wordmark disappears in GitHub dark

`README.md` line 3 embeds `dashboard/public/brand/lockup-horizontal.svg`, whose name is `fill="#1A1814"`. On GitHub’s dark background `#0D1117` that ink is **1.07:1**. The pine tile against the same ground is **1.96:1**. The name is gone; a dull green square remains.

GitHub will not swap in `lockup-horizontal-dark.svg`. Give the README asset its own plate: a `#F7F4EC` rectangle behind the existing lockup, with padding of at least the dot diameter (7.5 units at the lockup’s 48-unit mark), so the ink stays at 16.13:1 wherever the file is shown. Point line 3 of `README.md` at that file.

### 4. The header wears the name twice, and the tagline is a second tagline

From `960px`, `styles.css` line 940 hides `.brand .logo-mark` and the sidenav shows the mark plus “Agent Allowance” (`App.jsx` lines 432–434). The header `h1` is still “Agent Allowance” (`App.jsx` line 458). Desktop shows two wordmarks.

The header cluster also carries the sentence “The agent decides what to buy. It cannot decide what it is allowed to spend.” `docs/BRAND.md` line 3 sets the line as “Spending power for AI, with a human key.” The product now has two taglines.

The sidenav brand is `aria-hidden="true"`, so the accessible name is the header `h1`. Keep that. On `min-width: 960px`, show the mark and the name only in `.sidenav-brand`, and remove `aria-hidden` from that block. Leave the header for Freeze, Set up allowance, Present, and the theme control.

Use one line. Put “Spending power for AI, with a human key.” under the hero, or drop the header lede. Do not keep both.

Loading (`App.jsx` lines 1099–1101) repeats the 40px `mark.svg` plus the live name, which is the right small lockup. It sits in the content column above gray skeletons. Center that pair in the first view, with the same 12px gap, and keep it the only wordmark on screen while `connection === 'loading'`.

### 5. Dark mode throws the palette away, and two surfaces fail AA

`styles.css` lines 47–49 and 78–80 set `--pine` and `--pine-ink` to `#C6E6D6`. Pine is no longer pine. The header and the loading state still request `/brand/mark.svg` (`App.jsx` lines 433, 456, 1100), so the forest tile sits on `#121411` at 1.92:1 while buttons, the focus ring, and the selected nav color turn mint.

Hardcoded light fills then meet the dark ink:

| Surface | Rule | Pair in dark | Contrast |
| --- | --- | --- | --- |
| Demo menu | `.demo-pop` background `#fff`, color `var(--ink)` (`styles.css` lines 1663–1664 and 1677) | `#F4F0E6` on `#FFFFFF` | 1.14:1 |
| Blocked need | `.need.is-neutral` background `#F7F4EC` (`styles.css` line 1697), text inherits `--ink` | `#F4F0E6` on `#F7F4EC` | 1.04:1 |

The neutral row includes a 17px name and a 28px amount (`styles.css` lines 1680–1681). Both fail. The same row in light mode is fine, because `--ink` is `#1A1814` (16.13:1 on `#F7F4EC`).

The selected nav bar is `box-shadow: inset 4px 0 0 #1B4D3E` (line 1767) and the tab bar uses the same hex (line 1768). On dark surface `#1C1F1A` that bar is 1.73:1.

Disabled controls are hardcoded for light mode at line 1770: background `#E4DDD0`, text `#5C564C`. They pass contrast and they read as light-mode chips on a `#121411` page.

Fix the tokens. Keep `--pine: #1B4D3E` in dark. Use `#F4F0E6` for text and `#C6F36B` for the remainder accent. Point the header, sidenav, and loading image at `mark-dark.svg` when the theme is dark. Set `.demo-pop` background to `var(--surface)` and `.need.is-neutral` to `var(--pine-soft)` (dark value `#24302A`, which is 12.45:1 under `#F4F0E6` if pine-ink stays cream, or set the neutral text to `#1A1814` if the cream fill stays). Drive the nav indicator with `var(--pine)`. Build the disabled colors from tokens that exist in both themes.

### 6. The hero ring cannot wear lime and a light track at the same time

`SpendRing` in `App.jsx` lines 776–805 is a closed circle. `.ring-value` sets `stroke-linecap: round` (`styles.css` line 416). The hero then paints the value `#C6F36B` and the track `rgba(255, 255, 255, 0.45)` (lines 1634–1636).

Round caps are the spinner ending that `docs/BRAND.md` line 13 already rejected.

The track color cannot be repaired by picking a better gray. Luminance of `#1B4D3E` is `0.059` and luminance of `#C6F36B` is `0.772`. A single track color would need luminance at least `0.277` to clear 3:1 against pine and at most `0.224` to clear 3:1 against lime. No color sits in both ranges. The current track composites to about `#829D95` on `#1B4D3E`: **3.31:1** against pine and **2.28:1** against the lime arc. The two states of the meter blend into each other. This is the product’s main use of the accent, and `docs/BRAND.md` line 26 says the accent is that ring.

Fix it as one of these, and delete the round cap either way (`stroke-linecap: butt` on `.ring-value`):

- Lime arc only, on the pine hero. Set `.hero .ring-track` to `transparent`. `#C6F36B` on `#1B4D3E` is 7.55:1, with no second stroke beside it. Put an ink-free lime dot at the end of the arc if the mark’s dot should show up here.
- Or a cream disc, which is the earlier rule at lines 1464–1465 (`background: #FBF9F4`, value `#1B4D3E`) before the later block overrides it. On a `#F7F4EC` disc, pine is 8.77:1. A track of `#5A534A` is 6.90:1 on cream. Pine against `#5A534A` is only 1.27:1, so the value stroke has to be the one that touches the disc, with the track as a thinner inner line, or the track has to be a break in the disc rather than a gray stroke. The dot on that disc is ink `#1A1814` (16.13:1). Lime on cream is **1.16:1** and cannot be the dot there. `docs/BRAND.md` line 53 already says this.

Also drop `opacity: 0.7` on `.hero .figure .unit` (line 1630). The blended color is about `#B5C2B8`, 5.22:1 on `#1B4D3E`, which passes, and it shifts across the gradient (`#143D31` to `#1B4D3E`, line 1611). Set the unit to solid `#E4EFE8` (8.18:1 on `#1B4D3E`).

### 7. The demo card introduces a second red, a neon green, and a rubber stamp

`docs/BRAND.md` gives one red, `#8E2218` on `#F8E8E4`, and says the accent is one small place. The blocked-demo card does something else:

- `.attack-card` background `#141414`, left border `#E5484D` (`styles.css` lines 1729–1734).
- `.blocked-stamp` is `#E5484D` with `transform: rotate(-4deg)` (lines 1740–1751).
- `.attack-lost` is `#3DD68C` at 44px (line 1753).
- `.flow-track.is-alert .flow-step.is-rules .flow-dot` is `#E5484D` (line 1772).

`#E5484D` on `#141414` is 4.71:1, so the stamp scrapes through AA. It is still a different red. `#3DD68C` is outside the palette. The tilted stamp is the piece that looks generated.

`HeistDemo.jsx` line 114 titles the block “The Heist”. `App.jsx` lines 838–839 label the menu “Run the heist”. The brand voice in `docs/BRAND.md` lines 59–61 asks for plain sentences and the status words Needs you, Blocked, Paid, and Paid · Ledger.

Fix: paint the card with `#1A1814` or the existing device ground `#10241C`, use `#FFB4A8` for “Blocked” if it must sit on that ground (5.67:1 on `#1B4D3E`, and it is already the hero danger color at line 1479), and use `#F7F4EC` for the amount. Remove the rotation. Rename the control to the plain action it runs. Add `#FFB4A8` to the palette table as the on-pine danger, so the hero button stops being an undocumented hex.

### 8. The brand sheet teaches the wrong amber and the wrong red

`docs/brand-sheet.html` lines 80–81 paint the amber chip `#F8EFE4` and the red chip `#F8E8E4`, then caption them `#8A4518` and `#8E2218`. `docs/brand-sheet.png` is that page. A reader copies the peach as the amber.

Show the text on the fill: `#8A4518` on `#F8EFE4`, `#8E2218` on `#F8E8E4`, and print both hexes. Add the missing file `dashboard/public/brand/app-icon-light-512.png` to the table in `docs/BRAND.md` (it is on disk and absent from lines 38–51). Rebuild `docs/brand-sheet.png` from the corrected HTML. Add the 16px, 24px, and 32px marks on `#121411` as well as on the page color, since that is where the tile fails.

### 9. Replace the traced wordmark files with one source

The four lockups are the same Outfit outlines, flipped and scaled (`scale(0.02200 -0.02200)` in the horizontal files, `0.02000` in the stacked files), with coordinates such as `286.43367346938777` on line 11 of `lockup-horizontal.svg`. Each file nests a second `<svg>` for the mark (line 2). The setting itself is good: title case, cap center on the mark center, word space about 4.5 units at a 15.5-unit cap height, no clipped descender on the horizontal lockup (the `g` ends near `y=40.4` inside a 56-unit box).

A traced dump will drift the moment anyone changes a letter, and it already diverges from the live wordmark. The UI sets the name in Outfit with `letter-spacing: -0.03em` (`styles.css` line 180), loaded from Google Fonts in `dashboard/index.html` line 27. The README uses the outlines.

Fix: one lockup component, the mark plus live Outfit 600, tracking `0` or `-0.01em` (the outlines are tighter than `-0.03em`; match them on purpose). Self-host the two families. If a standalone SVG is still required for the README, export it from that component after the cream plate in item 3, with coordinates rounded to two decimals and the mark referenced once.

The stacked viewBox `0 0 170.2 100.1` starts the mark at `y=0`, so the art is flush with the top of the file. Pad every side by the dot diameter, 10 units at the stacked mark’s 64-unit size.

## Nice-to-have

- Set `theme-color` in `dashboard/index.html` line 11 to `#1B4D3E` in light mode. The script on line 22 already switches the dark value to `#121411`. The current light value `#ECE8DE` brands the browser chrome as the page, not the product.
- Raise `.chip` from `min-height: 36px` (line 1769) to `44px` at desktop widths. The 36px height passes WCAG 2.5.8 (24px). The rest of the app already uses 44px, and the header chips are the exception.
- Skeleton shimmer uses `var(--line)`, which is `#7C7468` (`.sk`, line 1017). On a white card that reads as a dirty bar. Use `#E4DDD0` on `#FFFFFF`.
- Delete the dead hero block at lines 1443–1467 or fold it into the winning block at 1610–1637. Two competing hero treatments are how the round cap and the lime track ended up combined.
- `.hero .btn.danger` (line 1479) is `#FFB4A8` on pine, 5.67:1. Keep it, and list it in `docs/BRAND.md` next to the status red so it stops looking like a one-off.
- The header row still holds Freeze, Set up allowance, Present, and the theme button beside the name at narrow widths (`App.jsx` lines 462–477, `.top` wraps at line 169). After the duplicate wordmark is gone, move Present into the existing Demo menu.
- `favicon.svg` as `image/svg+xml` plus a 32px PNG is enough. Drop the 512px `rel="icon"`.

## 16px evidence, in one place

Cairo raster of `dashboard/public/brand/mark.svg` at 16×16, white ground, classified by eye on the pixel grid:

- The counter stays pine. The band is about two cream pixels on the sides and across the bottom.
- The opening is at the top.
- Lime pixels: `(8,3) = #C6F36B`, `(9,3) = #C5F26B`, plus two antialiased neighbors. Nearest cream pixel is 2.0px away.
- On `#121411` the pine tile is a low-contrast mat (1.92:1) and the cream ring still reads. `mark-dark.svg` at the same size reads more clearly because the tile is gone.

So the mark reads at 16px. It reads as a small ring with a crumb of lime, which is why the favicon wants its own, slightly coarser drawing, and why the app icon wants to be full bleed.

## Verdict

Ship the color, the type, the status pills, and the idea of a limit cut out of a ring. Those are the 6 and the 7. Before this goes on a card, a tab, or a dark screen: one mark with a real favicon and a full-bleed icon, a light mark with no phantom tile, a README lockup on a cream plate, one wordmark in the chrome, a dark theme that stays pine, a hero meter whose track is not asked to do the impossible, and a demo card that uses the red already in the system.
