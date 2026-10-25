# Agent Allowance brand review

PR #16, branch `cursor/judge-review-fixes-42a9`, commit `59b6c9e`. Re-reviewed 25 October 2026 against the review of `77b3c90`.

Independent review of the arc mark from `scripts/build-brand.py`, the 2px pine keyline, `mark-light.svg` in the header, the phone reflow, the two-line activity rows, and the token pass in `dashboard/src/styles.css`. The bar is unchanged: a Mastercard or Revolut ship, clear of a generated look, WCAG AA, and a mark that reads at 16px.

This review does not edit PR #16.

## Scores

**Brand: 9/10. UI: 9/10.**

The two must-fixes from `77b3c90` are fixed, and the measurements match the spec. The disk is SVG arcs from one script. On a 16px favicon the lime stays two pixels from cream, with a pine pixel between them, including the diagonal. The light header mounts the tile-less mark, so the bite shows the page. The 390px screenshot keeps the page inside the viewport, and the activity rows are two lines. This is merge-ready for a demo.

## Earlier must-fixes

| # | Item | At `59b6c9e` |
| --- | --- | --- |
| 1 | One drawing copied into every slot; transparent pre-rounded icons; a 2×2 dot | **Fixed.** `scripts/build-brand.py` is the drawing. The icons are full-bleed and opaque. The 16px mark is a disk with a lime band. |
| 2 | Invisible cream plate on the page, and a pine tile on the dark lockups | **Fixed.** The header and the splash use `mark-light.svg`. Dark lockups keep the cream circle. |
| 3 | README wordmark on GitHub dark | **Fixed.** |
| 4 | Two wordmarks and two taglines | **Fixed.** One name per breakpoint. One tagline, now in the header. |
| 5 | Dark mode remapped pine and failed AA | **Fixed.** |
| 6 | Hero ring caps and an impossible track | **Fixed.** |
| 7 | Second red, neon green, tilted stamp, “The Heist” | **Fixed.** |
| 8 | Brand sheet captioned the fill with the foreground hex | **Fixed.** The keyline sentence now matches the raster. |
| 9 | Traced wordmarks copied by hand | **Fixed.** The same script sets the Outfit outlines, with the kerning pairs in one table. The product name in the app is live Outfit. |

The two items left open at `77b3c90`:

| Item | At `59b6c9e` |
| --- | --- |
| Pine keyline was 0.50px at 16px, and the spec said 2.24. One lime pixel touched cream on the diagonal. | **Fixed.** |
| Light header used `mark.svg`, whose cream plate is 1.11:1 on `#ECE8DE`. | **Fixed.** |

## What the new head holds

`scripts/build-brand.py` draws the disk with two `A` arcs and cuts the bite with two straight radials (`NOTCH_A0 = -42`, `NOTCH_A1 = 84`, inner radius `2.8`). The lime is a band inside the rim, not a polygon of chords. `dashboard/public/brand/mark.svg` is 613 bytes and contains eight arc commands. Outer pine is `OUTER_PINE = 4.0` viewBox units (`scripts/build-brand.py` line 40). The disk radius is `14.2` and the lime outer radius is `10.05`, so the pine between them is `4.15` units, which is `2.07px` when the 32-unit box is drawn at 16px.

A Cairo raster of `favicon.svg` at 16×16, classified on the pixel grid (`P` pine, `L` lime, `C` cream, `?` antialiased):

```
00 CCCCCCCCCCCCCCCC
01 CCCC  PPPP  CCCC
02 CCC PPPP PPP CCCC
03 CC PPPPP PPPP CC
04 C PPPPPP PLLPP C
05 C PPPPPP PLLPP C
06 PPPPPPPP PPLLPP C
07 PPPPPPPPP PLLPP
08 PPPPPPPPP PLLPP
09 PPPPPPPPPPPPPPP C
10 C PPPPPPPPPPPP C
11 C PPPPPPPPPP P C
12 CC PPPPPPPPPP CC
13 CCC PPPPPPPP CCC
14 CCCC  PPPP  CCCC
15 CCCCCCCCCCCCCCCC
```

Ten lime pixels. The nearest cream pixel is Chebyshev distance 2. No lime pixel touches cream on a side or a corner. `mark-light.svg` at 16px has the same disk and no cream pixels of its own: the bite is the page. `docs/BRAND.md` line 17 and line 59, and `docs/brand-sheet.html` line 143, now say 2 pixels and no corner contact. That sentence is true.

Corner pixels are still opaque:

| File | `(0,0)` |
| --- | --- |
| `dashboard/public/brand/app-icon-512.png` | `(247, 244, 236, 255)` `#F7F4EC` |
| `dashboard/public/brand/app-icon-light-512.png` | `(255, 255, 255, 255)` |
| `dashboard/public/brand/apple-touch-icon.png` | `(247, 244, 236, 255)` |
| `dashboard/public/brand/favicon-32.png` | `(247, 244, 236, 255)` |

The center of each is pine `(27, 77, 62, 255)`. On `app-icon-512.png` the disk spans 415 of 512 pixels, 81% of the tile. The script asks for 80%; the extra point is the antialiased rim. `dashboard/src/App.jsx` line 804 points the light image at `/brand/mark-light.svg`. The dark image is still `mark-dark.svg`, the disk on a cream circle `r="15.4"`.

The header lockup is the mark, the name, and the one tagline (`App.jsx` lines 465–470). From `960px`, `.brand { display: none }` (`styles.css` line 3085) and the sidenav carries the name. The tagline stays in the header. Below `720px` it wraps (`styles.css` line 3293). The 1440px desktop screenshot shows the full sentence beside the tools. The 390×844 phone screenshot shows it under the name, with Freeze, Set up allowance, Demo, and the theme control on the next rows. One non-page pixel sits on the right edge of that phone capture. The page does not scroll sideways there.

Activity rows are two lines (`App.jsx` lines 989–1001, `styles.css` lines 2743–2805). The first line is the avatar, the merchant, the amount, and the status pill. The second line is the task, the relative time, and the Bedrock tag. The title and the task ellipsize. Both screenshots show that stack, and the amount stays on the first line.

`styles.css` now has a type and radius scale: `--fs-1` 13px through `--fs-8` 88px, and `--r-1` through `--r-pill`. The hero meter is still a transparent track, butt caps, and `#C6F36B` (`styles.css` lines 2569–2575). The blocked-prompt card is still `#10241C` with `#FFB4A8`. The freeze banner is still `#8A4518` on `#F8EFE4` (lines 2935–2946). Hero flow labels that are not the active step are `#E4EFE8` on pine, 8.18:1 (lines 2263–2271).

## Remaining must-fix

None.

## Nice-to-have

- `scripts/build-brand.py` reads Outfit from `/tmp/brand-fonts/Outfit-wght.ttf` (line 18). The committed SVGs are already written, so a demo does not need the font. A rebuild of the lockups does. Put the font in the repo, or document that path next to the script.
- Four `@media (min-width: 960px)` blocks remain, at lines 3060, 3172, 3180, and 3260. The grid works. One block would finish the consolidation.
- `.hero-tagline` is `white-space: nowrap` with an ellipsis from `720px` up (`styles.css` lines 2578–2585). At `960px` the tools sit on the same row, so a narrow desktop can clip the sentence. It does not widen the page, because the tagline is `overflow: hidden`. Under `720px` it wraps, which is the phone behavior in the screenshot.
- The activity amount uses `--fs-4` (20px), the same size as the product name. On a 320px row the `70%` cap on `.row-end` (line 2783) is what keeps “Paid · Ledger” beside the figure. The 390px screenshot fits.

## Demo

Merge-ready for a demo. The mark, the header, the phone home screen, the dark theme, and the activity rows are in the committed screenshots and in the 16px raster. `dashboard/src/reflow.test.js` checks `scrollWidth` at 320 and 390 in light and dark. This review did not re-run that browser test. The 390px screenshot already shows the home screen inside the width.

## Verdict

Ship it for the demo. The disk, the 2px keyline, the tile-less header, the full-bleed icons, the cream-plate README, the pine dark theme, and the two-line rows are the 9 and the 9. After the demo, vendor the Outfit file the generator expects, and let the tagline wrap beside the tools so a 960px window does not ellipsize the only line.
