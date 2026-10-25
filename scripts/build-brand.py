#!/usr/bin/env python3
"""One source for the Agent Allowance mark, icons, and lockups.

The disk is a pine circle. Two straight radial cuts open a rim bite. A lime
band follows that rim inside the disk, and a pine keyline of one thickness
keeps every lime pixel off the cream, including the diagonal neighbors.
"""

import math
import sys
from pathlib import Path

import cairosvg
from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dashboard" / "public" / "brand"
FONT = Path("/tmp/brand-fonts/Outfit-wght.ttf")

PINE = "#1B4D3E"
CREAM = "#F7F4EC"
LIME = "#C6F36B"
INK = "#1A1814"
WHITE = "#FFFFFF"
PINE_RGB = (27, 77, 62)
LIME_RGB = (198, 243, 107)
CREAM_RGB = (247, 244, 236)

# ViewBox 32. The bite is on the upper right, not at 12 o'clock, and it stops
# short of the hub so the mark is not a pie chart or a power icon.
CX = CY = 16.0
DISK_R = 14.2
NOTCH_A0 = -42.0
NOTCH_A1 = 84.0
NOTCH_RI = 2.8
GAP = 1.15  # uniform cream gap between the disk body and the keyline
OUTER_PINE = 4.0  # 2.4 viewBox units thicker than the old 1.6, a full pine pixel at 16px
INNER_PINE = 2.3
SIDE_PINE = 3.4

KEY_RO = DISK_R - 0.15
KEY_A0 = NOTCH_A0 + math.degrees(GAP / KEY_RO)
KEY_A1 = NOTCH_A1 - math.degrees(GAP / KEY_RO)
KEY_RI = NOTCH_RI + GAP
LIME_RO = KEY_RO - OUTER_PINE
LIME_RI = KEY_RI + INNER_PINE
_MID = (LIME_RO + LIME_RI) / 2
_DANG = math.degrees(SIDE_PINE / _MID)
LIME_A0 = KEY_A0 + _DANG
LIME_A1 = KEY_A1 - _DANG


def fmt(point):
    return f"{point[0]:.2f} {point[1]:.2f}"


def pt(radius, deg):
    rad = math.radians(deg)
    return (CX + radius * math.cos(rad), CY - radius * math.sin(rad))


def arc_sector(r_outer, r_inner, a0, a1):
    """Annulus sector: two straight radials and two SVG A arcs."""
    large = 1 if abs(a1 - a0) > 180 else 0
    sweep = 0 if a1 > a0 else 1
    back = 1 - sweep
    return (
        f"M {fmt(pt(r_outer, a0))} "
        f"A {r_outer:.2f} {r_outer:.2f} 0 {large} {sweep} {fmt(pt(r_outer, a1))} "
        f"L {fmt(pt(r_inner, a1))} "
        f"A {r_inner:.2f} {r_inner:.2f} 0 {large} {back} {fmt(pt(r_inner, a0))} Z"
    )


def disk_with_notch():
    # Full circle, then an even-odd bite. The bite's outer edge is the rim.
    circle = (
        f"M {CX + DISK_R:.2f} {CY:.2f} "
        f"A {DISK_R:.2f} {DISK_R:.2f} 0 1 1 {CX - DISK_R:.2f} {CY:.2f} "
        f"A {DISK_R:.2f} {DISK_R:.2f} 0 1 1 {CX + DISK_R:.2f} {CY:.2f} Z"
    )
    notch = arc_sector(DISK_R + 0.4, NOTCH_RI, NOTCH_A0, NOTCH_A1)
    return f'<path fill="{PINE}" fill-rule="evenodd" d="{circle} {notch}"/>'


def artwork():
    if not (LIME_RO > LIME_RI and LIME_A1 > LIME_A0 and KEY_RO > KEY_RI):
        raise SystemExit(f"bad geometry lime {LIME_RI:.2f}-{LIME_RO:.2f} key {KEY_RI:.2f}-{KEY_RO:.2f}")
    return (
        disk_with_notch()
        + f'<path fill="{PINE}" d="{arc_sector(KEY_RO, KEY_RI, KEY_A0, KEY_A1)}"/>'
        + f'<path fill="{LIME}" d="{arc_sector(LIME_RO, LIME_RI, LIME_A0, LIME_A1)}"/>'
    )


def svg_doc(body, label="Agent Allowance"):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" '
        f'aria-label="{label}">\n  {body}\n</svg>\n'
    )


def inset_art(art, scale):
    return (
        f'<g transform="translate(16 16) scale({scale:.4f}) translate(-16 -16)">{art}</g>'
    )


def write_png(svg_name, dest, size):
    cairosvg.svg2png(url=str(OUT / svg_name), write_to=str(dest), output_width=size, output_height=size)


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


def chebyshev(image):
    width, height = image.size
    pix = image.load()
    lime = [(x, y) for y in range(height) for x in range(width) if kind(pix[x, y]) == "lime"]
    cream = [(x, y) for y in range(height) for x in range(width) if kind(pix[x, y]) == "cream"]
    if not lime or not cream:
        return None
    best = 99
    for x, y in lime:
        for cx, cy in cream:
            best = min(best, max(abs(x - cx), abs(y - cy)))
            if best <= 1:
                return best
    return best


def crisp(size):
    """Nearest-neighbor sample of the same geometry, no antialiasing."""
    image = Image.new("RGB", (size, size), CREAM_RGB)
    pix = image.load()

    def ang(x, y):
        return math.degrees(math.atan2(-(y - CY), x - CX))

    def radius(x, y):
        return math.hypot(x - CX, y - CY)

    def in_sector(a, r, a0, a1, ri, ro):
        span = (a - a0) % 360
        width = (a1 - a0) % 360
        return span <= width + 1e-9 and ri - 1e-9 <= r <= ro + 1e-9

    for y in range(size):
        for x in range(size):
            vx = (x + 0.5) * 32 / size
            vy = (y + 0.5) * 32 / size
            r = radius(vx, vy)
            a = ang(vx, vy)
            color = CREAM_RGB
            if r <= DISK_R and not in_sector(a, r, NOTCH_A0, NOTCH_A1, NOTCH_RI, DISK_R + 0.6):
                color = PINE_RGB
            if in_sector(a, r, KEY_A0, KEY_A1, KEY_RI, KEY_RO):
                color = PINE_RGB
            if in_sector(a, r, LIME_A0, LIME_A1, LIME_RI, LIME_RO):
                color = LIME_RGB
            pix[x, y] = color
    return image


def measure():
    print(
        f"geometry disk {DISK_R:.2f} lime {LIME_RI:.2f}-{LIME_RO:.2f} "
        f"key {KEY_RI:.2f}-{KEY_RO:.2f} angles {LIME_A0:.1f}..{LIME_A1:.1f}"
    )
    print(f"outer pine {OUTER_PINE:.2f} viewBox units, {OUTER_PINE * 16 / 32:.2f} px at 16")
    failed = False
    for label, image in (
        ("crisp-16", crisp(16)),
        ("crisp-32", crisp(32)),
    ):
        gap = chebyshev(image)
        hits = contacts(image)
        lime = sum(kind(px) == "lime" for px in image.getdata())
        print(f"  {label}: lime {lime} chebyshev {gap} contacts {len(hits)} {hits[:6]}")
        if label == "crisp-16":
            chars = {"lime": "L", "pine": "P", "cream": ".", "other": "?"}
            pix = image.load()
            for y in range(image.size[1]):
                print("".join(chars[kind(pix[x, y])] for x in range(image.size[0])))
        if hits or (gap is not None and gap < 2):
            failed = True
    fav = Image.open(OUT / "favicon-32.png").convert("RGBA").resize((16, 16), Image.Resampling.BOX)
    # Also the real 16px render.
    write_png("favicon.svg", "/tmp/mark-16.png", 16)
    rendered = Image.open("/tmp/mark-16.png").convert("RGBA")
    for label, image in (("favicon-16", rendered), ("favicon-32-box", fav)):
        gap = chebyshev(image)
        hits = contacts(image)
        lime = sum(kind(px) == "lime" for px in image.getdata())
        print(f"  {label}: lime {lime} chebyshev {gap} contacts {len(hits)}")
        if hits or (gap is not None and gap < 2):
            failed = True
            rendered.save("/tmp/mark-16-fail.png")
    # App icon disk is about 80% of the tile.
    icon = Image.open(OUT / "app-icon-512.png").convert("RGB")
    pix = icon.load()
    xs = [x for y in range(icon.size[1]) for x in range(icon.size[0]) if kind(pix[x, y]) == "pine" or kind(pix[x, y]) == "lime"]
    ys = [y for y in range(icon.size[1]) for x in range(icon.size[0]) if kind(pix[x, y]) == "pine" or kind(pix[x, y]) == "lime"]
    if xs:
        diameter = max(max(xs) - min(xs), max(ys) - min(ys)) + 1
        print(f"  app icon disk / tile {diameter / icon.size[0]:.3f}")
    return 1 if failed else 0


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


def lockup(horizontal, dark):
    text_fill = CREAM if dark else INK
    mark_name = "mark-dark.svg" if dark else "mark.svg"
    mark_body = (OUT / mark_name).read_text().split(">", 1)[1].rsplit("</svg>", 1)[0].strip()
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
    return doc, advances


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    art = artwork()
    # App icons: the disk diameter is 80% of the tile.
    icon_scale = (0.80 * 32) / (2 * DISK_R)
    files = {
        "mark.svg": svg_doc(f'<rect width="32" height="32" rx="7" fill="{CREAM}"/>{art}'),
        "mark-light.svg": svg_doc(art),
        "mark-dark.svg": svg_doc(f'<circle cx="16" cy="16" r="15.4" fill="{CREAM}"/>{art}'),
        "favicon.svg": svg_doc(f'<rect width="32" height="32" fill="{CREAM}"/>{art}'),
        "app-icon.svg": svg_doc(f'<rect width="32" height="32" fill="{CREAM}"/>{inset_art(art, icon_scale)}'),
        "app-icon-light.svg": svg_doc(f'<rect width="32" height="32" fill="{WHITE}"/>{inset_art(art, icon_scale)}'),
    }
    for name, text in files.items():
        (OUT / name).write_text(text)
    write_png("favicon.svg", OUT / "favicon-32.png", 32)
    write_png("app-icon.svg", OUT / "apple-touch-icon.png", 180)
    write_png("app-icon.svg", OUT / "app-icon-512.png", 512)
    write_png("app-icon-light.svg", OUT / "app-icon-light-512.png", 512)
    code = measure()
    if not FONT.exists():
        print("lockups skipped, font missing", FONT)
        return code
    for horizontal, dark, name in (
        (True, False, "lockup-horizontal.svg"),
        (True, True, "lockup-horizontal-dark.svg"),
        (False, False, "lockup-stacked.svg"),
        (False, True, "lockup-stacked-dark.svg"),
    ):
        doc, advances = lockup(horizontal, dark)
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
    for name in ("app-icon-512.png", "app-icon-light-512.png", "apple-touch-icon.png", "favicon-32.png"):
        image = Image.open(OUT / name)
        print(name, image.mode, image.size, image.getpixel((0, 0)))
    return code


if __name__ == "__main__":
    sys.exit(main())
