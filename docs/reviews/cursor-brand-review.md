# Agent Allowance brand review

PR #16, branch `cursor/judge-review-fixes-42a9`, commit `77b3c90`. Re-reviewed 25 October 2026 against the review of `c97dbd9`.

Independent review of the gauge-disk mark, the wordmarks, the app icon, and the favicon in `dashboard/public/brand/`, of `docs/BRAND.md` and `docs/brand-sheet.png` (source `docs/brand-sheet.html`), and of the brand as it is applied in the dashboard header, the loading splash, the grid, and `README.md`. The bar is unchanged: a Mastercard or Revolut ship, clear of a generated look, WCAG AA for text and UI boundaries, and a mark that reads at 16px.

This review does not edit PR #16.

## Scores

**Brand: 8/10. UI: 8/10.**

The open ring is gone. The mark is now a pine disk with a lime wedge in the upper-right rim, and that drawing holds from 16px through the 512px icon. Dark mode stays pine. The README lockup sits on a cream plate. The desktop shows one wordmark, the hero meter is lime on pine, and the blocked-prompt card uses the documented danger color. A brand studio would ship this system and send back two corrections: the keyline is half a pixel at 16px, and the header still mounts a cream plate that disappears on the page.

## Earlier must-fixes

| # | Item at `c97dbd9` | At `77b3c90` |
| --- | --- | --- |
| 1 | One SVG copied into the favicon, the app icon, and `LogoMark`; pre-rounded transparent icons; 512px `rel="icon"`; 16px dot only 2×2 | **Partly.** Icons, favicon slot, and the 16px read are fixed. The disk path is still pasted into every file. |
| 2 | `mark-light.svg` cream tile invisible (1.10:1 / 1.11:1). Dark lockups used a pine tile at 1.92:1 | **Partly.** `mark-light.svg` and the dark lockups are fixed. The header still uses `mark.svg`, whose cream plate fails on the page. |
| 3 | README ink wordmark 1.07:1 on GitHub dark | **Fixed.** |
| 4 | Two wordmarks from 960px, and two taglines | **Fixed.** |
| 5 | Dark mode remapped pine to mint; demo menu, neutral row, nav bar, and disabled chips failed | **Fixed.** |
| 6 | Hero ring used round caps and a track that could not clear 3:1 against both pine and lime | **Fixed.** |
| 7 | Demo card used `#E5484D`, `#3DD68C`, a rotated stamp, and “The Heist” | **Fixed.** |
| 8 | Brand sheet captioned the fill with the foreground hex; `app-icon-light` missing from the table | **Fixed.** |
| 9 | Traced wordmarks with 15-decimal coordinates, a nested `<svg>`, and four copies | **Partly.** Coordinates, nesting, and font hosting are fixed. The outlines are still copied. |

## What now holds

The disk is a circle, drawn as 120 chords. Outer radius is `14.201` from `(16, 16)`, and the largest radial error is `0.0045` units. Chord sagitta at 512px is `0.08px`. The rim does not facet. The hub is solid. The lime wedge stays in the rim: its farthest point is `(26.46, 7.94)`, radius `13.205`, so the cut does not reach the center and does not sit on the top. At 16px the favicon keeps a cluster of five lime pixels, `(12,4)`, `(12,5)`, `(13,5)`, `(13,6)`, and `(13,7)`. It reads as a disk with a bite, which is the symbol `docs/BRAND.md` line 16 describes.

The icon files are full-bleed and opaque. Corner pixel `(0,0)`:

| File | Pixel |
| --- | --- |
| `dashboard/public/brand/app-icon-512.png` | `(247, 244, 236, 255)` `#F7F4EC` |
| `dashboard/public/brand/app-icon-light-512.png` | `(255, 255, 255, 255)` |
| `dashboard/public/brand/apple-touch-icon.png` | `(247, 244, 236, 255)` |
| `dashboard/public/brand/favicon-32.png` | `(247, 244, 236, 255)` |

The center of each is pine `(27, 77, 62, 255)`. `dashboard/index.html` points `rel="icon"` at `favicon.svg` and `favicon-32.png` only, and `theme-color` is `#1B4D3E` (the inline script sets `#121411` when the theme is dark). `LogoMark` is gone. `BrandMark` in `dashboard/src/App.jsx` lines 780–786 swaps `mark.svg` and `mark-dark.svg`.

`mark-light.svg` has no rectangle. `mark-dark.svg` is the disk on a cream circle, `cx="16" cy="16" r="15.4" fill="#F7F4EC"`. `lockup-horizontal-dark.svg` and `lockup-stacked-dark.svg` use that circle and a cream name. Cream `#F7F4EC` on `#121411` is 16.85:1, and on GitHub’s `#0D1117` is 17.22:1.

`README.md` lines 3–7 use a `<picture>`: the dark source is `lockup-horizontal-dark.svg`, and the fallback is `lockup-readme.svg`, a `#F7F4EC` plate the size of the lockup (`240.71` by `64`). Ink `#1A1814` on that plate is 16.13:1. The plate still holds if a renderer drops the `<picture>`.

From `960px`, `dashboard/src/styles.css` line 3021 sets `.brand { display: none }`, and the sidenav shows the 32px mark plus one `h1` (`App.jsx` lines 436–437). Below that width the sidenav is `display: none` and the header `h1` is the name (`App.jsx` line 460). The header lede is gone. The only tagline is “Spending power for AI, with a human key.” at `App.jsx` line 535, in `.hero-tagline`, 15px, `var(--muted)`. Muted `#5A534A` on the page `#ECE8DE` is 6.19:1. The loading state is a fixed splash (`styles.css` lines 1521–1547) with a centered 40px mark and name, gap `12px`, and it hides `.brand` and `.sidenav-brand`.

Dark tokens keep `--pine: #1B4D3E` (`styles.css` lines 101 and 145). `--pine-ink` in dark is `#F4F0E6`. `.demo-pop` uses `var(--surface)` and `var(--ink)` (line 2602). `.need.is-neutral` uses `var(--pine-soft)` (line 2677): `#F4F0E6` on `#24302A` is 12.05:1, and `#1A1814` on `#E5F0EA` is 15.18:1. The selected nav item is a pine-soft pill with no pine inset bar (line 2870). Disabled controls use the theme tokens (line 2890): `#C9C2B4` on `#24302A` is 7.74:1, and the light pair `#5C564C` on `#E4DDD0` is 5.38:1.

The hero meter matches the fix. `.hero .ring-track` is `transparent`, `.hero .ring-value` is `#C6F36B` with `stroke-linecap: butt` (`styles.css` lines 2537–2543). Lime on pine is 7.55:1. `SpendRing` (`App.jsx` lines 789–820) places a lime dot, `r="6"`, at the end of the arc, and the SVG rotation of `-90deg` moves the arc and the dot together. The unit is solid `#E4EFE8` (8.18:1 on `#1B4D3E`). A later rule (lines 2187–2191) sets `.ring-label span` to 13px, `letter-spacing: 0`, `text-transform: none`. The hero label color is `#F7F4EC` (line 2552).

The blocked-prompt card is `#10241C` with a 4px `#FFB4A8` edge (`styles.css` lines 2752–2756). The stamp is `#FFB4A8` and scales from `1.4` to `1` (line 2965), with no rotation. The amount is `#F7F4EC` at 44px. `#FFB4A8` on `#10241C` is 9.56:1. `HeistDemo.jsx` line 116 and `App.jsx` line 856 say “Show a blocked prompt”. The title is “Blocked prompt”. `#FFB4A8` is in the palette table in `docs/BRAND.md` as the on-pine danger.

The brand sheet swatches are the text on the fill, with both hexes: `#F7F4EC` on `#1B4D3E`, `#1A1814` on `#F7F4EC`, `#C6F36B` on `#1B4D3E`, `#8A4518` on `#F8EFE4`, `#8E2218` on `#F8E8E4`, and `#FFB4A8` on `#10241C` (`docs/brand-sheet.html` lines 236–241). `app-icon-light.svg` and `app-icon-light-512.png` are in the file table. The sheet shows 16, 24, and 32 on the page and on `#121411`.

These pairs still pass AA (normal text 4.5:1, large text and UI boundaries 3:1):

| Pair | Contrast |
| --- | --- |
| `#F7F4EC` on `#1B4D3E` | 8.77:1 |
| `#C6F36B` on `#1B4D3E` | 7.55:1 |
| `#E4EFE8` on `#1B4D3E` | 8.18:1 |
| `#FFB4A8` on `#10241C` | 9.56:1 |
| `#FFB4A8` on `#1B4D3E` | 5.67:1 |
| `#1A1814` on `#F7F4EC` | 16.13:1 |
| `#F4F0E6` on `#121411` | 16.27:1 |
| `#C9C2B4` on `#121411` | 10.46:1 |
| `#F7F4EC` on `#121411` | 16.85:1 |
| `#9BE0C0` on `#1A3328` | 8.93:1 |
| `#F0C08A` on `#3A2C1C` | 8.10:1 |
| `#FFB4A8` on `#3A221C` | 8.66:1 |

Inter and Outfit are self-hosted in `dashboard/src/styles.css` lines 2–48. The product name uses Outfit at `letter-spacing: -0.01em` (line 339). Chips are `min-height: 44px` (line 2897). Skeletons use `#E4DDD0` in light and `#32362E` in dark. Present sits in the Demo menu (`App.jsx` lines 858–861).

The desktop grid is `232px` plus the page (`styles.css` lines 2996–3014). The sidenav is sticky, full height, on `var(--bg)`, with a 1px line. Home at `1100px` is `7fr` / `5fr`. The three screenshots at this commit (`docs/dashboard-desktop.png`, `docs/dashboard-mobile.png`, `docs/dashboard-dark.png`) show that chrome: one wordmark, the pine hero, the lime arc, and the dark theme on the cream-circle mark.

## Remaining must-fix

### 1. The keyline is half a pixel at 16px, and the spec says 2.24

`docs/BRAND.md` line 16 says the pine keyline “stays 2.24 pixels off the disk” on a crisp 16px grid. `docs/brand-sheet.html` line 143 says it “stays at least 2 pixels from the disk.”

The geometry does not. The disk radius is `14.201`. The lime point closest to the rim is `(26.46, 7.94)` at radius `13.205`. The gap is `0.996` units. A 32-unit viewBox drawn at 16px is `0.5` px per unit, so the gap is `0.50px`. At 32px it is `1.00px`.

On the Cairo raster of `dashboard/public/brand/favicon.svg` at 16×16, lime pixel `(12, 5)` = `#90BE5D` touches cream pixel `(11, 6)` = `#E1E3DA` on the diagonal. Everywhere else the wedge is clear of the cream. The mark still reads. The written clearance does not, and the promise on line 16 that the lime “never touches cream alone” fails at that one pixel.

Thicken the pine between the lime and the rim by about `1` viewBox unit, so a 16px raster keeps a full pine pixel between them. `2` viewBox units is `1px` at 16px. Then replace the `2.24` sentence and the brand-sheet note with the measured gap. The disk `d` is byte-identical in these eleven files (path sha256 prefix `e50403e905` for the six marks, `858ff0cd9c` for the five lockups, which include the same disk):

- `dashboard/public/brand/mark.svg`
- `dashboard/public/brand/mark-light.svg`
- `dashboard/public/brand/mark-dark.svg`
- `dashboard/public/brand/favicon.svg`
- `dashboard/public/brand/app-icon.svg`
- `dashboard/public/brand/app-icon-light.svg`
- `dashboard/public/brand/lockup-horizontal.svg`
- `dashboard/public/brand/lockup-horizontal-dark.svg`
- `dashboard/public/brand/lockup-stacked.svg`
- `dashboard/public/brand/lockup-stacked-dark.svg`
- `dashboard/public/brand/lockup-readme.svg`

Change the drawing once and copy the result. A second, coarser favicon is not required if that gap holds.

### 2. The header still wears the cream plate that fails on the page

`mark-light.svg` is the disk with no tile, which is the right file for `#ECE8DE`. `BrandMark` does not use it. `App.jsx` line 783 points the light image at `/brand/mark.svg`. That file opens with `<rect width="32" height="32" rx="7" fill="#F7F4EC"/>`, and `docs/BRAND.md` line 42 assigns it to the header and the loading state.

| Pair | Contrast |
| --- | --- |
| `#F7F4EC` on `#ECE8DE` | 1.11:1 |
| `#F7F4EC` on `#FFFFFF` | 1.10:1 |

A 40px composite of `mark.svg` on `#ECE8DE` leaves the plate a few levels off the page. The disk reads. The rounded square does not, so the spent cut cannot show the page, which is what `mark-light.svg` is for. On a dark page the swap to `mark-dark.svg` is the right one: the cream circle is 16.85:1 on `#121411`.

Point the light `img` at `/brand/mark-light.svg`. Keep the `rx="7"` cream tile for lockups that sit on white or on a photograph, or drop it there too. The dark `img` stays on `mark-dark.svg`.

## Nice-to-have

- The disk path and the Outfit outlines are still copied, not referenced. Six mark files share one path. Five lockups share another, including the wordmark. `docs/BRAND.md` says the mark is drawn once in each file, which is true per file and still eleven places to edit. One component, mark plus live Outfit 600 at `-0.01em`, and an export for `lockup-readme.svg`, finishes item 9. The stacked file is no longer flush to the top: viewBox `0 0 167.92 112.14`, mark at `translate(51.96 10.00)`.
- `styles.css` still has three separate `@media (min-width: 960px)` blocks, at lines 2996, 3108, and 3116. The grid works. One block would match the “consolidated” pass.
- Two `h1` elements stay in the DOM (`App.jsx` lines 437 and 460). `display: none` removes one from the accessibility tree at each breakpoint, and the splash `h1` (line 1121) shows only while the other two are hidden. One `h1`, with the other name as a `p`, would make that obvious.
- `.hero-tagline` is hidden with `.lede` at `max-height: 800px` and `min-width: 1100px` (`styles.css` line 3274). On a short laptop the line is gone. That is a density choice, and it is the only tagline, so the screen does not grow a second one.
- The base `.ring-track` is still `var(--track)`, `#6F675C` (`styles.css` line 74). Pine `#1B4D3E` on that track is 1.73:1. The hero overrides the track to `transparent`, and `SpendRing` is only used there. Any new ring on a light card has to use the same treatment, because no single track color can clear 3:1 against both pine and lime.

## 16px evidence

Cairo raster of `favicon.svg` at 16×16, classified on the pixel grid. `P` pine, `L` lime, `C` cream:

```
00 CCCCCCCCCCCCCCCC
01 CCCCC PPP   CCCC
02 CCC PPPPP C PP C
03 CC PPPPPP  PP C
04 C PPPPPPP  PL P
05 C PPPPPPP  PLLP
06 PPPPPPPPPP PL
07 PPPPPPPPP  PL
08 PPPPPPPPP  PPPP
09 PPPPPPPPP  CC
10 C PPPPPPPPP CC
11 C PPPPPPPPPP C
12 CC PPPPPPPPP CC
13 CCC PPPPPPPP CCC
14 CCCCC PPPP CCCC
15 CCCCCCCCCCCCCCCC
```

The disk stays closed. The lime sits on the right, in the rim. One diagonal step joins lime `(12,5)` to cream `(11,6)`. At 32px that same gap is about 2.8px of separation in the raster, which is the 32px drawing, not the 16px one. At 96px and at 512px the wedge, the hub, and the rim are smooth.

## Verdict

Ship the disk, the palette, the type, the full-bleed icons, the cream-plate README, the single wordmark, the pine dark theme, the lime hero arc, and the blocked-prompt card. Those are the 8 and the 8. Before this goes on a tab or in the header: give the lime a real pixel of pine at 16px and correct the 2.24px line, and mount `mark-light.svg` on the light page so the plate is not a second, invisible tile.
