#!/usr/bin/env python3
"""One source for the Agent Allowance mark, icons, and lockups.

The shipped mark is the gauge disk: a pine disk with a wedge cut from the
upper-right rim, and a lime band in that wedge for what is left to spend.
The other concepts stay in CONCEPTS for the record. `python3
scripts/build-brand.py` writes the shipped assets, dashboard/src/brandMark.js
(the same geometry for the animated in-app mark), and docs/logo-concepts.png.
"""

import math
import sys
from io import BytesIO
from pathlib import Path

import cairosvg
from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dashboard" / "public" / "brand"
SHEET = ROOT / "docs" / "logo-concepts.png"
FONT = Path(__file__).resolve().parent / "fonts" / "Outfit-wght.ttf"
LABEL_FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
LABEL_FONT_BOLD = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")

PINE = "#1B4D3E"
CREAM = "#F7F4EC"
LIME = "#C6F36B"
INK = "#1A1814"
WHITE = "#FFFFFF"
PAGE = "#ECE8DE"
PINE_RGB = (27, 77, 62)
LIME_RGB = (198, 243, 107)
CREAM_RGB = (247, 244, 236)
INK_RGB = (26, 24, 20)

# Change this name to ship a different mark. The sheet always draws every concept.
CONCEPT = "gauge-disk"

CONCEPTS = (
    {
        "id": "gauge-disk",
        "name": "Gauge disk (chosen)",
        "line": "The disk is the allowance. The cut is what is spent. Lime is what is left.",
    },
    {
        "id": "gauge-key",
        "name": "Gauge key",
        "line": "The bow is the allowance. Lime is what is left. The bit is the human key.",
    },
    {
        "id": "card-latch",
        "name": "Card latch",
        "line": "A spending card. The lime bar is what is left. The teeth lock it.",
    },
    {
        "id": "agent-seal",
        "name": "Agent seal",
        "line": "A rounded limit. The lime node is the agent. The slot takes a key.",
    },
    {
        "id": "key-monogram",
        "name": "Key monogram",
        "line": "A for Allowance. The lime bar is what is left. The leg ends in a bit.",
    },
)


def fmt(point):
    return f"{point[0]:.2f} {point[1]:.2f}"


def pt(cx, cy, radius, deg):
    rad = math.radians(deg)
    return (cx + radius * math.cos(rad), cy - radius * math.sin(rad))


def arc_sector(cx, cy, r_outer, r_inner, a0, a1):
    """Annulus sector. Angles grow counterclockwise from the right, like a gauge."""
    large = 1 if abs(a1 - a0) > 180 else 0
    sweep = 0 if a1 > a0 else 1
    back = 1 - sweep
    return (
        f"M {fmt(pt(cx, cy, r_outer, a0))} "
        f"A {r_outer:.2f} {r_outer:.2f} 0 {large} {sweep} {fmt(pt(cx, cy, r_outer, a1))} "
        f"L {fmt(pt(cx, cy, r_inner, a1))} "
        f"A {r_inner:.2f} {r_inner:.2f} 0 {large} {back} {fmt(pt(cx, cy, r_inner, a0))} Z"
    )


def circle(cx, cy, r, fill):
    return f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="{fill}"/>'


def rect(x, y, w, h, fill, rx=0):
    radius = f' rx="{rx:.2f}"' if rx else ""
    return (
        f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}"{radius} fill="{fill}"/>'
    )


def rrect_path(x, y, w, h, r):
    x2, y2 = x + w, y + h
    return (
        f"M {x + r:.2f} {y:.2f} "
        f"H {x2 - r:.2f} A {r:.2f} {r:.2f} 0 0 1 {x2:.2f} {y + r:.2f} "
        f"V {y2 - r:.2f} A {r:.2f} {r:.2f} 0 0 1 {x2 - r:.2f} {y2:.2f} "
        f"H {x + r:.2f} A {r:.2f} {r:.2f} 0 0 1 {x:.2f} {y2 - r:.2f} "
        f"V {y + r:.2f} A {r:.2f} {r:.2f} 0 0 1 {x + r:.2f} {y:.2f} Z"
    )


# Gauge disk geometry, viewBox 32, angles counterclockwise from 3 o'clock.
# The wedge is centered at 22 degrees, so it reads as a dial reading, not a
# pie slice at 12 o'clock and not a power icon. Every width below is at least
# one device pixel at 32px, so the cuts stay crisp in a tab and the sidebar.
DISK_R = 14.6
WEDGE_MID = 22.0
WEDGE_SPAN = 112.0
HUB_R = 3.0  # the cut stops at a hub, so the disk keeps its center
CUT = 1.5  # cream cut between the disk and the wedge: 1.5px at 32px
RIM_PINE = 2.6  # pine between the lime and the rim
HUB_PINE = 2.2  # pine between the lime and the hub cut
SIDE_PINE = 2.3  # pine between the lime and each radial cut
WEDGE_A0 = WEDGE_MID - WEDGE_SPAN / 2
WEDGE_A1 = WEDGE_MID + WEDGE_SPAN / 2


def offset_sector(r_outer, r_inner, a0, a1, off):
    """Sector whose straight sides run parallel to the radials at a0 and a1,
    `off` units inside them. Parallel sides keep a cut the same width from hub
    to rim, where a radial cut would fan open toward the rim."""
    oa0 = a0 + math.degrees(math.asin(off / r_outer))
    oa1 = a1 - math.degrees(math.asin(off / r_outer))
    ia0 = a0 + math.degrees(math.asin(off / r_inner))
    ia1 = a1 - math.degrees(math.asin(off / r_inner))
    large = 1 if (oa1 - oa0) > 180 else 0
    return (
        f"M {fmt(pt(16, 16, r_outer, oa0))} "
        f"A {r_outer:.2f} {r_outer:.2f} 0 {large} 0 {fmt(pt(16, 16, r_outer, oa1))} "
        f"L {fmt(pt(16, 16, r_inner, ia1))} "
        f"A {r_inner:.2f} {r_inner:.2f} 0 0 1 {fmt(pt(16, 16, r_inner, ia0))} Z"
    )


def disk_geometry():
    """Paths for the shipped mark. Shared by the SVG files and the app."""
    seg_ri = HUB_R + CUT
    lime_ro = DISK_R - RIM_PINE
    lime_ri = seg_ri + HUB_PINE
    mid = (lime_ro + lime_ri) / 2
    if lime_ro - lime_ri < 4:
        raise SystemExit(f"bad disk geometry lime {lime_ri:.2f}-{lime_ro:.2f}")
    # The disk is one outline: the long way round the rim, in along one cut,
    # the short way round the hub so it stays solid, and out along the other. No even-odd bite, so nothing pokes past
    # the rim. Each cut is CUT wide, half on each side of the wedge radial.
    half = CUT / 2
    body_a0 = WEDGE_A1 + math.degrees(math.asin(half / DISK_R))
    body_a1 = WEDGE_A0 + 360 - math.degrees(math.asin(half / DISK_R))
    hub_a0 = WEDGE_A1 + math.degrees(math.asin(half / HUB_R))
    hub_a1 = WEDGE_A0 + 360 - math.degrees(math.asin(half / HUB_R))
    disk = (
        f"M {fmt(pt(16, 16, DISK_R, body_a0))} "
        f"A {DISK_R:.2f} {DISK_R:.2f} 0 1 0 {fmt(pt(16, 16, DISK_R, body_a1))} "
        f"L {fmt(pt(16, 16, HUB_R, hub_a1))} "
        f"A {HUB_R:.2f} {HUB_R:.2f} 0 0 0 {fmt(pt(16, 16, HUB_R, hub_a0))} Z"
    )
    return {
        "disk": disk,
        "segment": offset_sector(DISK_R, seg_ri, WEDGE_A0, WEDGE_A1, half),
        "lime": offset_sector(lime_ro, lime_ri, WEDGE_A0, WEDGE_A1, half + SIDE_PINE),
        "sweep": {
            "r": round(mid, 2),
            "width": round(lime_ro - lime_ri + 1, 2),
            "a0": round(WEDGE_A0 + math.degrees((half + SIDE_PINE) / mid) - 3, 2),
            "a1": round(WEDGE_A1 - math.degrees((half + SIDE_PINE) / mid) + 3, 2),
        },
    }


def artwork_gauge_disk():
    geo = disk_geometry()
    return (
        f'<path fill="{PINE}" d="{geo["disk"]}"/>'
        f'<path fill="{PINE}" d="{geo["segment"]}"/>'
        f'<path fill="{LIME}" d="{geo["lime"]}"/>'
    )


def artwork_gauge_disk_small():
    """The 16px cut. Sub-pixel cream cuts turn to grey mush in a tab, so the
    favicon keeps the solid disk and a wider lime band on whole pixels."""
    r = 15.0
    return (
        circle(16, 16, r, PINE)
        + f'<path fill="{LIME}" d="{arc_sector(16, 16, 12.0, 6.0, WEDGE_MID - 44, WEDGE_MID + 44)}"/>'
    )


def artwork_gauge_key():
    """Key in profile. The bow is a solid gauge, not a ring and not a pie."""
    cx, cy, radius = 10.7, 14.5, 9.15
    shaft_top = cy - 2.85
    shaft_h = 5.7
    shaft_left = cx + 2.4
    body = (
        circle(cx, cy, radius, PINE)
        + rect(shaft_left, shaft_top, 31.15 - shaft_left, shaft_h, PINE, 0.7)
        + rect(21.15, shaft_top + shaft_h - 0.35, 3.7, 6.7, PINE, 0.55)
        + rect(27.55, shaft_top + shaft_h - 0.35, 3.55, 4.35, PINE, 0.55)
    )
    # Lime sits inside the bow, clear of the shaft, with pine on every side.
    lime = (
        f'<path fill="{LIME}" d="{arc_sector(cx, cy, radius - 2.55, radius - 6.35, 108, 252)}"/>'
    )
    return body + lime


def artwork_card_latch():
    """Payment card whose right edge is a key bit. The lime bar is remaining spend."""
    return (
        rect(2.15, 5.2, 19.7, 21.5, PINE, 5.1)
        + rect(5.45, 17.15, 13.1, 4.85, LIME, 1.45)
        + rect(18.6, 11.55, 12.5, 5.55, PINE, 0.7)
        + rect(23.55, 16.85, 3.65, 6.85, PINE, 0.55)
        + rect(28.55, 16.85, 2.7, 4.45, PINE, 0.55)
    )


def artwork_agent_seal():
    """The allowance is a rounded square. A lime node is the agent. A slot is the key."""
    outer = rrect_path(3.05, 3.05, 25.9, 25.9, 7.4)
    slot = "M 13.35 23.15 H 18.65 V 32.2 H 13.35 Z"
    return (
        f'<path fill="{PINE}" fill-rule="evenodd" d="{outer} {slot}"/>'
        + circle(16, 13.15, 4.55, LIME)
    )


def artwork_key_monogram():
    """A geometric A. The crossbar is lime. The right foot carries a key bit."""
    outer = (
        "M 13.6 2.7 L 24.7 28.8 L 19.15 28.8 L 17.35 23.85 "
        "L 8.15 23.85 L 6.35 28.8 L 1.15 28.8 Z"
    )
    counter = "M 13.6 9.55 L 10.55 17.55 L 16.65 17.55 Z"
    bar = rect(9.15, 18.35, 8.7, 3.55, LIME, 0.4)
    bit = (
        rect(20.35, 16.4, 10.3, 4.7, PINE, 0.55)
        + rect(23.85, 20.85, 3.15, 5.55, PINE, 0.45)
        + rect(28.15, 20.85, 2.55, 3.55, PINE, 0.45)
    )
    return (
        f'<path fill="{PINE}" fill-rule="evenodd" d="{outer} {counter}"/>'
        + bar
        + bit
    )


DRAW = {
    "gauge-disk": artwork_gauge_disk,
    "gauge-key": artwork_gauge_key,
    "card-latch": artwork_card_latch,
    "agent-seal": artwork_agent_seal,
    "key-monogram": artwork_key_monogram,
}


def svg_doc(body, label="Agent Allowance", size=32):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" role="img" '
        f'aria-label="{label}">\n  {body}\n</svg>\n'
    )


def plate(art, rx=7):
    return f'<rect width="32" height="32" rx="{rx}" fill="{CREAM}"/>{art}'


def inset_art(art, scale):
    return (
        f'<g transform="translate(16 16) scale({scale:.4f}) translate(-16 -16)">{art}</g>'
    )


def centered_art(art):
    # Scale to the app icon's 80% and center the drawn bounds, not the viewBox, so clear space is even.
    image = render_svg(svg_doc(art), 320)
    box = image.getbbox()
    scale = content_scale(art)
    if not box:
        return inset_art(art, scale)
    cx = (box[0] + box[2]) / 2 / 10
    cy = (box[1] + box[3]) / 2 / 10
    return f'<g transform="translate(16 16) scale({scale:.4f}) translate({-cx:.2f} {-cy:.2f})">{art}</g>'


def tile(art, rx=7):
    # A tiled mark keeps the app icon's clear space, so the bit never touches the tile edge.
    return f'<rect width="32" height="32" rx="{rx}" fill="{CREAM}"/>{centered_art(art)}'


def render_svg(text, width, height=None):
    png = cairosvg.svg2png(
        bytestring=text.encode(),
        output_width=width,
        output_height=height or width,
    )
    return Image.open(BytesIO(png)).convert("RGBA")


def composite(image, rgb):
    base = Image.new("RGBA", image.size, rgb + (255,))
    base.alpha_composite(image)
    return base.convert("RGB")


def content_scale(art):
    image = render_svg(svg_doc(art), 320)
    box = image.getbbox()
    if not box:
        return 1
    longest = max(box[2] - box[0], box[3] - box[1]) / 320 * 32
    if longest <= 0:
        return 1
    return (0.80 * 32) / longest


def kind(pixel):
    r, g, b = pixel[:3]
    alpha = pixel[3] if len(pixel) > 3 else 255
    if alpha < 16:
        return "cream"
    if g > 165 and r > 120 and b < 175 and g > b + 35:
        return "lime"
    if r < 100 and g < 140 and b < 120 and g + 8 > r and g > b:
        return "pine"
    if r > 210 and g > 205 and b > 190 and abs(r - g) < 40:
        return "cream"
    return "other"


def contacts(image):
    width, height = image.size
    pix = image.load()
    hits = []
    for y in range(height):
        for x in range(width):
            if kind(pix[x, y]) != "lime":
                continue
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    xx, yy = x + dx, y + dy
                    if xx < 0 or yy < 0 or xx >= width or yy >= height:
                        hits.append((x, y, "edge"))
                        continue
                    if kind(pix[xx, yy]) == "cream":
                        hits.append((x, y, (xx, yy)))
    return hits


class SvgPen(BasePen):
    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.parts = []

    def _fmt(self, p):
        return f"{p[0]:.2f} {p[1]:.2f}"

    def _moveTo(self, p):
        self.parts.append("M " + self._fmt(p))

    def _lineTo(self, p):
        self.parts.append("L " + self._fmt(p))

    def _qCurveToOne(self, p1, p2):
        self.parts.append(f"Q {self._fmt(p1)} {self._fmt(p2)}")

    def _curveToOne(self, p1, p2, p3):
        self.parts.append(f"C {self._fmt(p1)} {self._fmt(p2)} {self._fmt(p3)}")

    def _closePath(self):
        self.parts.append("Z")


KERNS = {
    ("A", "l"): -70,
    ("l", "l"): -36,
    ("l", "o"): -18,
    ("o", "w"): -12,
    ("w", "a"): -28,
    ("a", "n"): -14,
    ("n", "c"): -22,
    ("c", "e"): -30,
    ("A", "g"): -20,
    ("g", "e"): -10,
    ("e", "n"): -8,
    ("n", "t"): -12,
}


def layout_text(text):
    font = instantiateVariableFont(TTFont(FONT), {"wght": 600}, inplace=False)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    cursor = 0.0
    paths = []
    prev = None
    advances = []
    for ch in text:
        name = cmap[ord(ch)]
        extra = 0
        if prev == " ":
            cursor -= glyphs["space"].width * 0.18
        if prev and (prev, ch) in KERNS:
            extra = KERNS[(prev, ch)]
            cursor += extra
        pen = SvgPen(glyphs)
        glyphs[name].draw(pen)
        paths.append((cursor, pen.parts))
        advances.append((ch, extra, glyphs[name].width))
        cursor += glyphs[name].width
        prev = ch
    return paths, cursor, advances


def text_svg(text, em, fill):
    paths, width, advances = layout_text(text)
    scale = em / 1000
    groups = []
    for cursor, parts in paths:
        if not parts:
            continue
        groups.append(
            f'<path transform="translate({cursor * scale:.2f} 0) scale({scale:.2f} {-scale:.2f})" '
            f'd="{" ".join(parts)}" fill="{fill}"/>'
        )
    return "\n    ".join(groups), width * scale, advances


def lockup_doc(art, horizontal, dark):
    text_fill = CREAM if dark else INK
    # Dark lockup sits on a transparent page. The cream tile carries the mark; the wordmark is cream.
    mark_body = tile(art, 8) if dark else tile(art)
    label = "Agent Allowance"
    if horizontal:
        pad, mark, gap, em = 8, 48, 14, 22
        scale = mark / 32
        text, tw, advances = text_svg(label, em, text_fill)
        width = pad + mark + gap + tw + pad
        height = 64
        cap = 703 * (em / 1000)
        baseline = (height / 2) + cap / 2
        tx = pad + mark + gap
        body = (
            f'<g transform="translate({pad:.2f} {pad:.2f}) scale({scale:.2f})">{mark_body}</g>\n'
            f'    <g transform="translate({tx:.2f} {baseline:.2f})">\n    {text}\n    </g>'
        )
    else:
        pad, mark, gap, em = 10, 64, 12, 20
        scale = mark / 32
        text, tw, advances = text_svg(label, em, text_fill)
        width = max(pad + mark + pad, tw + pad * 2)
        cap = 703 * (em / 1000)
        baseline = pad + mark + gap + cap
        height = baseline + pad + (em - cap) * 0.35
        body = (
            f'<g transform="translate({(width - mark) / 2:.2f} {pad:.2f}) scale({scale:.2f})">{mark_body}</g>\n'
            f'    <g transform="translate({(width - tw) / 2:.2f} {baseline:.2f})">\n    {text}\n    </g>'
        )
    doc = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.2f} {height:.2f}" '
        f'role="img" aria-label="Agent Allowance">\n  {body}\n</svg>\n'
    )
    return doc, advances, width, height


def small_art():
    return artwork_gauge_disk_small() if CONCEPT == "gauge-disk" else DRAW[CONCEPT]()


def write_mark_module():
    geo = disk_geometry()
    sweep = geo["sweep"]
    a0, a1 = math.radians(sweep["a0"]), math.radians(sweep["a1"])
    r = sweep["r"]
    start = (16 + r * math.cos(a0), 16 - r * math.sin(a0))
    end = (16 + r * math.cos(a1), 16 - r * math.sin(a1))
    sweep_d = f"M {fmt(start)} A {r:.2f} {r:.2f} 0 0 0 {fmt(end)}"
    text = (
        "// Written by scripts/build-brand.py. Do not edit by hand.\n"
        "export const MARK = {\n"
        f"  pine: '{PINE}',\n"
        f"  accent: '{LIME}',\n"
        f"  cream: '{CREAM}',\n"
        f"  disk: '{geo['disk']}',\n"
        f"  segment: '{geo['segment']}',\n"
        f"  lime: '{geo['lime']}',\n"
        f"  sweep: '{sweep_d}',\n"
        f"  sweepWidth: {sweep['width']},\n"
        f"  scale: {content_scale(artwork_gauge_disk()):.4f},\n"
        "};\n"
    )
    (ROOT / "dashboard" / "src" / "brandMark.js").write_text(text)


def write_assets(art):
    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        "mark.svg": svg_doc(tile(art)),
        "mark-light.svg": svg_doc(art),
        "mark-dark.svg": svg_doc(tile(art, 8)),
        "favicon.svg": svg_doc(f'<rect width="32" height="32" fill="{CREAM}"/>{small_art()}'),
        "app-icon.svg": svg_doc(f'<rect width="32" height="32" fill="{CREAM}"/>{centered_art(art)}'),
        "app-icon-light.svg": svg_doc(f'<rect width="32" height="32" fill="{WHITE}"/>{centered_art(art)}'),
    }
    for name, text in files.items():
        (OUT / name).write_text(text)
    cairosvg.svg2png(url=str(OUT / "favicon.svg"), write_to=str(OUT / "favicon-32.png"), output_width=32, output_height=32)
    cairosvg.svg2png(url=str(OUT / "app-icon.svg"), write_to=str(OUT / "apple-touch-icon.png"), output_width=180, output_height=180)
    cairosvg.svg2png(url=str(OUT / "app-icon.svg"), write_to=str(OUT / "app-icon-512.png"), output_width=512, output_height=512)
    cairosvg.svg2png(url=str(OUT / "app-icon-light.svg"), write_to=str(OUT / "app-icon-light-512.png"), output_width=512, output_height=512)
    if not FONT.exists():
        print("Outfit variable font is required for lockups:", FONT, file=sys.stderr)
        return 1
    for horizontal, dark, name in (
        (True, False, "lockup-horizontal.svg"),
        (True, True, "lockup-horizontal-dark.svg"),
        (False, False, "lockup-stacked.svg"),
        (False, True, "lockup-stacked-dark.svg"),
    ):
        doc, advances, _w, _h = lockup_doc(art, horizontal, dark)
        (OUT / name).write_text(doc)
        print(name, [(ch, extra) for ch, extra, _width in advances])
    horiz = (OUT / "lockup-horizontal.svg").read_text()
    vb = horiz.split('viewBox="', 1)[1].split('"', 1)[0]
    inner = horiz.split(">", 1)[1].rsplit("</svg>", 1)[0]
    w, h = vb.split()[2], vb.split()[3]
    readme = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="Agent Allowance">\n'
        f'  <rect width="{w}" height="{h}" fill="{CREAM}"/>\n'
        f"  {inner.strip()}\n</svg>\n"
    )
    (OUT / "lockup-readme.svg").write_text(readme)
    return measure(art)


def measure(art):
    failed = False
    favicon = svg_doc(f'<rect width="32" height="32" fill="{CREAM}"/>{small_art()}')
    for label, size in (("favicon-16", 16), ("favicon-32", 32)):
        image = render_svg(favicon, size)
        hits = contacts(image)
        lime = sum(kind(px) == "lime" for px in image.getdata())
        print(f"  {label}: lime {lime} contacts {len(hits)} {hits[:4]}")
        if label == "favicon-16":
            chars = {"lime": "L", "pine": "P", "cream": ".", "other": "?"}
            pix = image.load()
            for y in range(image.size[1]):
                print("".join(chars[kind(pix[x, y])] for x in range(image.size[0])))
        if hits:
            failed = True
    icon = render_svg(
        svg_doc(f'<rect width="32" height="32" fill="{CREAM}"/>{inset_art(art, content_scale(art))}'),
        512,
    ).convert("RGB")
    pix = icon.load()
    xs = [x for y in range(icon.size[1]) for x in range(icon.size[0]) if kind(pix[x, y]) in ("pine", "lime")]
    ys = [y for y in range(icon.size[1]) for x in range(icon.size[0]) if kind(pix[x, y]) in ("pine", "lime")]
    if xs:
        diameter = max(max(xs) - min(xs), max(ys) - min(ys)) + 1
        print(f"  app icon art / tile {diameter / icon.size[0]:.3f}")
    return 1 if failed else 0


def cell(art, size, ground):
    if ground == "pine":
        image = composite(render_svg(svg_doc(tile(art, 8)), size), PINE_RGB)
    else:
        image = composite(render_svg(svg_doc(art), size), CREAM_RGB)
    return image


def zoom(image, factor):
    return image.resize((image.width * factor, image.height * factor), Image.Resampling.NEAREST)


def draw_sheet():
    """One board the owner can scan. 16 and 32 are nearest-neighbor enlargements of the real pixels."""
    columns = [
        ("16px ×4", "cream", 16, 4),
        ("16px ×4", "pine", 16, 4),
        ("32px ×2", "cream", 32, 2),
        ("32px ×2", "pine", 32, 2),
        ("180px", "cream", 180, 1),
        ("180px", "pine", 180, 1),
        ("Lockup", "lockup", 0, 1),
    ]
    pad = 28
    gap = 18
    label_h = 36
    caption_h = 22
    row_art = 180
    text_w = 280
    col_w = []
    for _title, kind_name, size, factor in columns:
        if kind_name == "lockup":
            col_w.append(460)
        else:
            col_w.append(max(size * factor, 88))
    width = pad * 2 + text_w + gap + sum(col_w) + gap * (len(col_w) - 1)
    row_h = label_h + row_art + caption_h
    height = pad + 78 + (row_h + 22) * len(CONCEPTS) + pad
    sheet = Image.new("RGB", (width, height), (236, 232, 222))
    draw = ImageDraw.Draw(sheet)
    title_font = ImageFont.truetype(str(LABEL_FONT_BOLD), 32)
    name_font = ImageFont.truetype(str(LABEL_FONT_BOLD), 22)
    body_font = ImageFont.truetype(str(LABEL_FONT), 15)
    cap_font = ImageFont.truetype(str(LABEL_FONT), 13)
    draw.text((pad, pad), "Agent Allowance — logo concepts", font=title_font, fill=INK_RGB)
    draw.text(
        (pad, pad + 42),
        "16 and 32 are the real pixels, enlarged without smoothing. Pine cells use the cream plate the dark UI uses.",
        font=body_font,
        fill=(90, 83, 74),
    )
    y = pad + 78
    for concept in CONCEPTS:
        art = DRAW[concept["id"]]()
        card = Image.new("RGB", (width - pad * 2, row_h), (255, 255, 255))
        sheet.paste(card, (pad, y))
        draw.text((pad + 16, y + 16), concept["name"], font=name_font, fill=INK_RGB)
        draw.text((pad + 16, y + 46), concept["line"], font=body_font, fill=(90, 83, 74))
        if concept["id"] == CONCEPT:
            draw.text((pad + 16, y + 72), "Chosen. Shipped in the app, favicon, and app icons.", font=cap_font, fill=PINE_RGB)
        x = pad + text_w
        for title, kind_name, size, factor in columns:
            if kind_name == "lockup":
                doc, _adv, lw, lh = lockup_doc(art, True, False)
                image = composite(render_svg(doc, 440, max(1, round(440 * lh / lw))), CREAM_RGB)
                fitted = image.copy()
                fitted.thumbnail((col_w[-1] - 8, row_art - 8), Image.Resampling.LANCZOS)
            else:
                image = cell(art, size, kind_name)
                fitted = zoom(image, factor) if factor != 1 else image
            ox = x + (col_w[columns.index((title, kind_name, size, factor))] - fitted.width) // 2
            oy = y + label_h + (row_art - fitted.height) // 2
            sheet.paste(fitted, (ox, oy))
            caption = f"{title} · {kind_name}" if kind_name != "lockup" else "Lockup"
            draw.text((x, y + label_h + row_art), caption, font=cap_font, fill=(90, 83, 74))
            x += col_w[columns.index((title, kind_name, size, factor))] + gap
        y += row_h + 22
    SHEET.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(SHEET, "PNG")
    print(f"wrote {SHEET} {sheet.size}")


def main():
    if CONCEPT not in DRAW:
        print(f"Unknown CONCEPT {CONCEPT}", file=sys.stderr)
        return 1
    draw_sheet()
    art = DRAW[CONCEPT]()
    code = write_assets(art)
    if CONCEPT == "gauge-disk":
        write_mark_module()
    for name in ("app-icon-512.png", "app-icon-light-512.png", "apple-touch-icon.png", "favicon-32.png"):
        image = Image.open(OUT / name)
        print(name, image.mode, image.size, image.getpixel((0, 0)))
    # Large studies for the sizes a favicon, a tab, and an app icon actually are.
    study = ROOT / "docs" / "logo-study"
    study.mkdir(parents=True, exist_ok=True)
    for concept in CONCEPTS:
        piece = DRAW[concept["id"]]()
        for size in (16, 32, 180, 512):
            composite(render_svg(svg_doc(piece), size), CREAM_RGB).save(study / f"{concept['id']}-cream-{size}.png")
            composite(render_svg(svg_doc(plate(piece, 8)), size), PINE_RGB).save(study / f"{concept['id']}-pine-{size}.png")
    return code


if __name__ == "__main__":
    sys.exit(main())
