# Agent Allowance brand

Spending power for AI, with a human key.

The mark is a pine key on cream. The bow is the allowance: a ring with a lime arc for what is left to spend. The bit is the human key that has to turn before the agent can step outside the rules. The same drawing is the favicon, the app icon, and the sidebar lockup. Four directions were drawn in `scripts/build-brand.py` (`gauge-key`, `card-latch`, `agent-seal`, `key-monogram`). The overview is `docs/logo-concepts.png`. The shipped mark is `gauge-key`. Change `CONCEPT` in that script to swap.

## Iterations

Each pass was judged at 16px, then at full size, against four things: the mark has to stay legible at 16px, it has to be its own symbol, it has to sit in the pine palette, and it must not look like a stock icon.

1. A closed ring, a stem, and a gold dot in the middle. At 16px it read as an exclamation point. That is an alarm. The product is a limit you set, not a warning. Rejected.
2. A thin, almost complete ring with a small dot floating in the gap. The ring looked like a spinner, and the dot disappeared at 16px. The two parts did not belong to one shape. Rejected.
3. A thick stroked ring with round caps and the lime dot seated on the upper end. At full size the idea was right. At 16px the right side of the ring broke into scattered pixels, the bottom turned into a cream slab, and the lime fused into the cream. It read as a blob, and the round caps made it a loading icon. Rejected.
4. The ring became a filled band with flat radial cuts, thicker, and the gap opened to about a quarter of the circle so the dot could sit clear of the stroke. At 16px the band held together and the lime no longer melted into the cream. The opening was so wide that the mark read as a letter C with a badge on it, and the bottom of the band was heavier than the sides. Rejected.
5. The gap narrowed to 52 degrees. The dot sits on the midline of the band, inside the opening, with pine between it and the cream. The ring is recentered so the sides and the bottom carry the same weight. The cuts stay flat, so the opening looks made, not like a round-cap spinner. The lime is only on the pine tile, where it contrasts. On a light surface the mark has no tile and the dot is ink, because lime on cream does not. The favicon was a separate drawing, and the app icon was the product mark on a full-bleed square.
6. The ring still read as a power symbol: a gap, a band, and a dot. At 16px the dot and the band collapsed into each other. The mark is now one pine disk. The upper-right rim is cut away and a lime wedge sits in the cut, with a pine keyline so the lime never touches cream alone. The cut does not reach the hub, and it is not at the top, so it is not a pie chart or a power icon. The same drawing is the favicon and both app icons. The wordmark tightens Allowance at Al, wa, and ce.
7. The outer pine, between the lime and the rim, was only 1.6 viewBox units. At 16px that is less than a pixel, so a lime pixel could touch cream on a corner. The pine there is now 4.00 viewBox units, 2 pixels on a crisp 16px grid. Every lime pixel stays at least one pine pixel from cream, including the diagonal. The bite is two straight radial cuts. The lime is a band that follows the rim inside the disk, and the cream gap around the keyline is one width. The paths are SVG arcs, not a polygon. `scripts/build-brand.py` is the only drawing, and it writes the mark, the favicon, both app icons, and the lockups. The app-icon disk is 80% of the tile.
8. The disk still read as a chart. Four new marks were drawn and checked at 16, 32, and 180 on cream and on pine: a gauge key, a card latch, an agent seal, and an A with a key bit. The gauge key won. At 16px the bow stays a closed shape and the bit stays teeth, not a blob. The lime arc is the remaining allowance. The teeth are the approval. `card-latch` was the clearest story and the most generic. `agent-seal` was a badge. `key-monogram` broke at 16px. Set `CONCEPT` in `scripts/build-brand.py` to one of those four names and rerun the script.

## Palette

| Role | Hex | Use |
| --- | --- | --- |
| Pine | `#1B4D3E` | The disk, the hero’s end (`#143D31` to `#1B4D3E`), selected controls |
| Pine ink | `#143D31` | Selected text, and the dark end of the hero |
| Cream | `#F7F4EC` | Type on pine, the app-icon ground, the circle behind the disk on a dark page |
| Page | `#ECE8DE` | Page background. The light header uses the tile-less mark on this, not a cream plate |
| Ink | `#1A1814` | Text on cream |
| Accent | `#C6F36B` | The lime wedge, what is left, and the hero arc |
| Amber | `#8A4518` on `#F8EFE4` | Needs you |
| Red | `#8E2218` on `#F8E8E4` | Blocked, on a light surface |
| On pine | `#FFB4A8` | Blocked on the pine hero and on the dark demo card |

The accent is one small place, not a fill. Amber and red are status, not decoration.

## Type

Inter 400, 500, 600, and 700 for the interface. Outfit 600 and 700 for the wordmark, the product name, and the balance. Labels are 13px, sentence case, with no tracking. The lockup script reads the vendored Outfit variable font at `scripts/fonts/Outfit-wght.ttf` (SIL Open Font License 1.1, `scripts/fonts/OFL.txt`) and instantiates weight 600. The interface self-hosts `dashboard/public/fonts/outfit-600.woff2` and `outfit-700.woff2`.

## Logo

| File | Use |
| --- | --- |
| `dashboard/public/brand/mark.svg` | Cream tile, corner 7, the key centered at the app icon's 80% so the bit never touches the edge. Lockups and the brand sheet |
| `dashboard/public/brand/mark-light.svg` | The same disk with no tile. Header and loading, light theme. The notch shows the page |
| `dashboard/public/brand/mark-dark.svg` | The same centered key on a cream tile, corner 8, so it reads on a dark page with even clear space. Dark lockups use this |
| `dashboard/public/brand/lockup-horizontal.svg` | Cream tile and the ink name. Allowance is kerned at Al, wa, and ce |
| `dashboard/public/brand/lockup-horizontal-dark.svg` | `mark-dark.svg` and the cream name |
| `dashboard/public/brand/lockup-stacked.svg` | Cream tile above the ink name |
| `dashboard/public/brand/lockup-stacked-dark.svg` | `mark-dark.svg` above the cream name |
| `dashboard/public/brand/lockup-readme.svg` | Horizontal lockup on a cream plate |
| `dashboard/public/brand/app-icon.svg` | Full-bleed cream square, no corner radius and no transparency. The disk is 80% of the tile. The system masks it |
| `dashboard/public/brand/app-icon-light.svg` | Full-bleed white square, the same inset disk |
| `dashboard/public/brand/favicon.svg` | The same disk on a cream square, drawn so the lime still reads at 16px |
| `dashboard/public/brand/favicon-32.png` | 32px PNG of the favicon |
| `dashboard/public/brand/apple-touch-icon.png` | 180px PNG of the cream app icon |
| `dashboard/public/brand/app-icon-512.png` | 512px PNG of the cream app icon |
| `dashboard/public/brand/app-icon-light-512.png` | 512px PNG of the white app icon |

The product name in the app is live Outfit, tracked at `-0.01em`. Inter and Outfit are self-hosted. The standalone lockups are Outfit paths with coordinates rounded to two decimals, and the mark is drawn once in each file from `scripts/build-brand.py`. The wordmark’s custom touch is the kerning of Allowance: Al, wa, and ce are tightened, and the space before Allowance is slightly tighter. The lime is `#C6F36B` everywhere. Measured on a crisp 16px grid, the pine between the lime and the rim is 2 pixels (4.00 viewBox units). No lime pixel touches cream, not even on a corner.

Clear space on every side is 8 units, a quarter of the tile. Do not close the disk, cut the wedge to the hub, or add a stem in the opening. Do not set the mark smaller than 16px. Do not recolor the lime to red or amber. Do not bake a corner into the app icon.

`docs/brand-sheet.png` shows the disk, the favicon beside a power icon at 16px, the lockups, the clear-space box, the don’ts, and the mark at 16, 24, and 32 on the page and on `#121411`.

## Voice

Plain sentences. Say what happened and what the person can do. Status words are Needs you, Blocked, Paid, and Paid · Ledger. The blocked-prompt demo uses those words. Do not shout in labels, and do not joke with sample identifiers.
