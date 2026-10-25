# Agent Allowance brand

Spending power for AI, with a human key.

The mark is an open ring. The gap is the limit you set. The lime dot rides the open end, which is the allowance still left. It is not a warning, and it is not a letter with a bar through it.

## Iterations

Each pass was judged at 16px, then at full size, against four things: the mark has to stay legible at 16px, it has to be its own symbol, it has to sit in the pine palette, and it must not look like a stock icon.

1. A closed ring, a stem, and a gold dot in the middle. At 16px it read as an exclamation point. That is an alarm. The product is a limit you set, not a warning. Rejected.
2. A thin, almost complete ring with a small dot floating in the gap. The ring looked like a spinner, and the dot disappeared at 16px. The two parts did not belong to one shape. Rejected.
3. A thick stroked ring with round caps and the lime dot seated on the upper end. At full size the idea was right. At 16px the right side of the ring broke into scattered pixels, the bottom turned into a cream slab, and the lime fused into the cream. It read as a blob, and the round caps made it a loading icon. Rejected.
4. The ring became a filled band with flat radial cuts, thicker, and the gap opened to about a quarter of the circle so the dot could sit clear of the stroke. At 16px the band held together and the lime no longer melted into the cream. The opening was so wide that the mark read as a letter C with a badge on it, and the bottom of the band was heavier than the sides. Rejected.
5. The gap narrowed to 52 degrees. The dot sits on the midline of the band, inside the opening, with pine between it and the cream. The ring is recentered so the sides and the bottom carry the same weight. The cuts stay flat, so the opening looks made, not like a round-cap spinner. The lime is only on the pine tile, where it contrasts. On a light surface the mark has no tile and the dot is ink, because lime on cream does not. This is the product mark. The favicon is a separate drawing for 16px, with a wider gap and a dot of radius 3.2. The app icon is the product mark on a full-bleed square, with no baked corner.

## Palette

| Role | Hex | Use |
| --- | --- | --- |
| Pine | `#1B4D3E` | Primary. App icon, hero, mark tile |
| Pine ink | `#143D31` | Selected text |
| Cream | `#F7F4EC` | Type on pine, the ring on the pine tile |
| Page | `#ECE8DE` | Page background |
| Ink | `#1A1814` | Text on cream |
| Accent | `#C6F36B` | The remaining-allowance dot on pine, and the hero arc that shows what is left |
| Amber | `#8A4518` on `#F8EFE4` | Needs you |
| Red | `#8E2218` on `#F8E8E4` | Blocked, on a light surface |
| On pine | `#FFB4A8` | Blocked on the pine hero and on the dark demo card |

The accent is one small place, not a fill. Amber and red are status, not decoration.

## Type

Inter 400, 500, 600, and 700 for the interface. Outfit 600 and 700 for the wordmark, the product name, and the balance. Labels are 13px, sentence case, with no tracking.

## Logo

| File | Use |
| --- | --- |
| `dashboard/public/brand/mark.svg` | Pine tile with a 7-unit corner, cream ring, lime dot. Header and loading, light theme |
| `dashboard/public/brand/mark-light.svg` | Pine ring and ink dot, no tile. Light surfaces where a cream tile would disappear |
| `dashboard/public/brand/mark-dark.svg` | Cream ring and lime dot, no tile. Header, sidenav, and loading in dark theme. Dark lockups use this mark |
| `dashboard/public/brand/lockup-horizontal.svg` | Pine tile and the ink name, for light pages |
| `dashboard/public/brand/lockup-horizontal-dark.svg` | `mark-dark.svg` and the cream name, for dark pages |
| `dashboard/public/brand/lockup-stacked.svg` | Pine tile above the ink name. Every side is padded by the dot |
| `dashboard/public/brand/lockup-stacked-dark.svg` | `mark-dark.svg` above the cream name, same padding |
| `dashboard/public/brand/lockup-readme.svg` | Horizontal lockup on a cream plate, so the ink name stays readable on a dark page |
| `dashboard/public/brand/app-icon.svg` | Full-bleed pine square, no corner radius and no transparency. The system masks it |
| `dashboard/public/brand/app-icon-light.svg` | Full-bleed cream square, pine ring, ink dot |
| `dashboard/public/brand/favicon.svg` | Its own 16px drawing. Square pine, a wider top gap, dot radius 3.2 |
| `dashboard/public/brand/favicon-32.png` | 32px PNG of the favicon drawing |
| `dashboard/public/brand/apple-touch-icon.png` | 180px PNG of the full-bleed app icon |
| `dashboard/public/brand/app-icon-512.png` | 512px PNG of the full-bleed app icon |
| `dashboard/public/brand/app-icon-light-512.png` | 512px PNG of the light app icon |

The product name in the app is live Outfit, tracked at `-0.01em`. Inter and Outfit are self-hosted. The standalone lockups are Outfit paths with coordinates rounded to two decimals, and the mark is drawn once in each file. On the pine tile the dot is `#C6F36B`. Where there is no tile, the light mark uses an ink dot, because lime on cream does not hold.

Clear space on every side is the diameter of the lime dot. Do not close the ring, put a word inside it, or add a second accent. Do not set the mark smaller than 16px. Do not recolor the lime dot to red or amber. Do not put the product mark in the favicon slot, and do not bake a corner into the app icon.

`docs/brand-sheet.png` shows the mark, the favicon, both lockups, the README plate, light and dark, the app icon, and the mark at 16, 24, and 32 on the page and on `#121411`.

## Voice

Plain sentences. Say what happened and what the person can do. Status words are Needs you, Blocked, Paid, and Paid · Ledger. The blocked-prompt demo uses those words. Do not shout in labels, and do not joke with sample identifiers.
