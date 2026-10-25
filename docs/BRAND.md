# Agent Allowance brand

Spending power for AI, with a human key.

The mark is an open ring. The gap is the limit you set. The lime dot rides the open end, which is the allowance still left. It is not a warning, and it is not a letter with a bar through it.

## Iterations

Each pass was judged at 16px, then at full size, against four things: the mark has to stay legible at 16px, it has to be its own symbol, it has to sit in the pine palette, and it must not look like a stock icon.

1. A closed ring, a stem, and a gold dot in the middle. At 16px it read as an exclamation point. That is an alarm. The product is a limit you set, not a warning. Rejected.
2. A thin, almost complete ring with a small dot floating in the gap. The ring looked like a spinner, and the dot disappeared at 16px. The two parts did not belong to one shape. Rejected.
3. A thick stroked ring with round caps and the lime dot seated on the upper end. At full size the idea was right. At 16px the right side of the ring broke into scattered pixels, the bottom turned into a cream slab, and the lime fused into the cream. It read as a blob, and the round caps made it a loading icon. Rejected.
4. The ring became a filled band with flat radial cuts, thicker, and the gap opened to about a quarter of the circle so the dot could sit clear of the stroke. At 16px the band held together and the lime no longer melted into the cream. The opening was so wide that the mark read as a letter C with a badge on it, and the bottom of the band was heavier than the sides. Rejected.
5. The gap narrowed to 52 degrees. The dot sits on the midline of the band, inside the opening, with pine between it and the cream. The ring is recentered so the sides and the bottom carry the same weight. The cuts stay flat, so the opening looks made, not like a round-cap spinner. The lime is only on the pine tile, where it contrasts. On the cream tile the dot is ink, because lime on cream does not. This is the mark.

## Palette

| Role | Hex | Use |
| --- | --- | --- |
| Pine | `#1B4D3E` | Primary. App icon, hero, mark tile |
| Pine ink | `#143D31` | Selected text |
| Cream | `#F7F4EC` | Type on pine, the ring on the pine tile |
| Page | `#ECE8DE` | Page background |
| Ink | `#1A1814` | Text on cream |
| Accent | `#C6F36B` | The remaining-allowance dot, and the ring in the product that shows what is left |
| Amber | `#8A4518` on `#F8EFE4` | Needs you |
| Red | `#8E2218` on `#F8E8E4` | Blocked |

The accent is one small place, not a fill. Amber and red are status, not decoration.

## Type

Inter 400, 500, 600, and 700 for the interface. Outfit 600 and 700 for the wordmark, the product name, and the balance. Labels are 13px, sentence case, with no tracking.

## Logo

| File | Use |
| --- | --- |
| `dashboard/public/brand/mark.svg` | Pine tile, cream ring, lime dot. Header, loading, favicon source |
| `dashboard/public/brand/mark-light.svg` | Cream tile, pine ring, ink dot. Light surfaces |
| `dashboard/public/brand/mark-dark.svg` | Cream ring and lime dot, no tile. Dark surfaces |
| `dashboard/public/brand/lockup-horizontal.svg` | Mark and the name on one line, for light pages |
| `dashboard/public/brand/lockup-horizontal-dark.svg` | Same lockup, cream name, for dark pages |
| `dashboard/public/brand/lockup-stacked.svg` | Mark above the name, for light pages |
| `dashboard/public/brand/lockup-stacked-dark.svg` | Stacked lockup, cream name, for dark pages |
| `dashboard/public/brand/app-icon.svg` | Rounded pine tile, the app icon |
| `dashboard/public/brand/favicon.svg` | Browser tab |
| `dashboard/public/brand/favicon-32.png` | 32px PNG |
| `dashboard/public/brand/apple-touch-icon.png` | 180px PNG |
| `dashboard/public/brand/app-icon-512.png` | 512px PNG |

The wordmark is Outfit, drawn as paths, so it does not depend on a font being installed. On the pine tile the dot is `#C6F36B`. On the cream tile the dot is ink `#1A1814`, because the lime accent does not hold on cream.

Clear space on every side is the diameter of the lime dot. Do not close the ring, put a word inside it, or add a second accent. Do not set the mark smaller than 16px. Do not recolor the lime dot to red or amber.

`docs/brand-sheet.png` shows the mark, both lockups, light and dark, the app icon, and the mark at 16, 24, and 32.

## Voice

Plain sentences. Say what happened and what the person can do. Status words are Needs you, Blocked, Paid, and Paid · Ledger. Do not shout in labels, and do not joke with sample identifiers.
