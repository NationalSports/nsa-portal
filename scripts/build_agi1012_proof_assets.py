#!/usr/bin/env python3
"""Build clean, recolorable flat-proof assets for the AGI-1012 jersey.

The supplied front/back renders contain the correct garment lighting and layout,
but also contain baked colors and sample decorations.  This script keeps the
real knit/fold shading, removes those sample decorations, and emits an exact
flat zone map for the builder's production renderer.
"""

from pathlib import Path
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public" / "uniform"

ZONE = {
    "body": (255, 0, 0),
    "sleeveL": (0, 255, 0),
    "sleeveR": (0, 0, 255),
    "collar": (255, 255, 0),
    "bodyStripe": (255, 0, 255),
    "sleeveBandL": (0, 255, 255),
    "sleeveBandR": (255, 128, 0),
}


def is_white(px):
    r, g, b, a = px
    return a >= 96 and min(r, g, b) >= 208 and max(r, g, b) - min(r, g, b) <= 42


def sleeve_side(x, y, width):
    """Return the garment side (left/right/body) using the visible armhole seam."""
    if y > 255:
        return None
    # The sleeve/body seam runs diagonally from the collarbone to the underarm.
    if y <= 60:
        left_edge = 181
    elif y <= 135:
        left_edge = 181 - (y - 60) * (69 / 75)
    else:
        left_edge = 112 - (y - 135) * (8 / 120)
    right_edge = width - left_edge
    if x < left_edge:
        return "left"
    if x > right_edge:
        return "right"
    return None


def classify(view, x, y, px, width):
    side = sleeve_side(x, y, width)
    white = is_white(px)

    # Exact AGI-1012 chest stripe. The small baked sample crest is inside this
    # rectangle, so include it explicitly even though those pixels are colored.
    if view == "front" and 120 <= y <= 188 and 106 <= x <= width - 106:
        if white or (138 <= x <= 187 and 137 <= y <= 181):
            return "bodyStripe"

    # Collar is an independent builder area on both faces.
    if white and y <= 116 and 176 <= x <= width - 176:
        return "collar"

    # Bands follow the sleeve opening. The lightness test preserves the real,
    # curved band edge instead of approximating it with a vertical block.
    if white and side == "left" and 155 <= y <= 236:
        return "sleeveBandL"
    if white and side == "right" and 155 <= y <= 236:
        return "sleeveBandR"

    if side == "left":
        return "sleeveL"
    if side == "right":
        return "sleeveR"
    return "body"


def luminance(px):
    r, g, b, _ = px
    return r * 0.299 + g * 0.587 + b * 0.114


def clean_sample_art(src, view):
    """Remove only the baked decoration pixels, feathering into nearby fabric."""
    width, height = src.size
    original = src.load()
    defect = Image.new("L", src.size, 0)
    defect_px = defect.load()

    if view == "front":
        box = (130, 128, 196, 192)
        # The reference crest sits entirely within the white chest stripe.
        # Replace the full footprint (not just its colored pixels) so its
        # anti-aliased edge cannot survive as a gray silhouette.
        for y in range(134, 187):
            for x in range(136, 191):
                defect_px[x, y] = 255
        shift_x, shift_y = 92, 0
    else:
        box = (180, 166, 320, 302)
        # The baked back number includes a dark maroon anti-aliased outline that
        # is too close to the fabric hue for reliable color-keying. Replace its
        # entire interior and use a broad feather for an invisible transition.
        for y in range(174, 294):
            for x in range(188, 312):
                defect_px[x, y] = 255
        shift_x, shift_y = 0, 112

    # Grow over anti-aliased outlines, then soften the boundary so the replacement
    # inherits surrounding fold lighting without creating a rectangular patch.
    defect = defect.filter(ImageFilter.GaussianBlur(18)) if view == "back" else defect
    replacement = src.copy()
    replacement_px = replacement.load()
    for y in range(box[1], box[3] + 1):
        for x in range(box[0], box[2] + 1):
            sx = max(0, min(width - 1, x + shift_x))
            sy = max(0, min(height - 1, y + shift_y))
            replacement_px[x, y] = original[sx, sy]
    return Image.composite(replacement, src, defect)


def build(view):
    src_path = PUBLIC / f"agi-1012-reference-{view}.png"
    src = Image.open(src_path).convert("RGBA")
    clean = clean_sample_art(src, view)
    width, height = src.size
    pixels = src.load()
    clean_pixels = clean.load()

    zone_for = {}
    mask = Image.new("RGBA", src.size, (0, 0, 0, 0))
    mask_px = mask.load()
    for y in range(height):
        for x in range(width):
            px = pixels[x, y]
            if px[3] < 32:
                continue
            zone = classify(view, x, y, px, width)
            zone_for[(x, y)] = zone
            mask_px[x, y] = (*ZONE[zone], px[3])

    # Use the clean left band as the construction master for both sleeves. The
    # original right render contains a deep fold through its white band; color
    # thresholding there alone produces gaps even though the sewn panel is
    # continuous. Mirroring the panel map keeps both openings crisp while the
    # right sleeve still uses its own (darker) real lighting plate.
    for (x, y), zone in list(zone_for.items()):
        if zone == "sleeveBandR":
            zone_for[(x, y)] = "sleeveR"
            mask_px[x, y] = (*ZONE["sleeveR"], pixels[x, y][3])
    for (x, y), zone in list(zone_for.items()):
        if zone != "sleeveBandL":
            continue
        xr = width - 1 - x
        if pixels[xr, y][3] >= 32 and sleeve_side(xr, y, width) == "right":
            zone_for[(xr, y)] = "sleeveBandR"
            mask_px[xr, y] = (*ZONE["sleeveBandR"], pixels[xr, y][3])

    samples = {name: [] for name in ZONE}
    for (x, y), zone in zone_for.items():
        # Exclude baked sample art from the lighting statistics.
        baked_front = view == "front" and 138 <= x <= 187 and 137 <= y <= 181
        baked_back = view == "back" and 202 <= x <= 294 and 188 <= y <= 274
        if not baked_front and not baked_back:
            samples[zone].append(luminance(clean_pixels[x, y]))

    means = {
        zone: (sum(vals) / len(vals) if vals else 180.0)
        for zone, vals in samples.items()
    }

    base = Image.new("RGBA", src.size, (0, 0, 0, 0))
    base_px = base.load()
    for (x, y), zone in zone_for.items():
        source = clean_pixels[x, y]

        # Normalize each construction area separately. Flat fabric lands near
        # white, while wrinkles, knit, and edge shadows remain in the plate for
        # realistic multiply tinting at any selected color.
        relative = luminance(source) / max(1.0, means[zone])
        gray = int(max(82, min(255, 236 * relative)))
        base_px[x, y] = (gray, gray, gray, source[3])

    base.save(PUBLIC / f"agi-1012-proof-base-{view}.png", optimize=True)
    mask.save(PUBLIC / f"agi-1012-proof-mask-{view}.png", optimize=True)


if __name__ == "__main__":
    build("front")
    build("back")
