#!/usr/bin/env python3
"""Build editable AGI-1011 artwork masks from the approved soccer foundation.

Run once with normal Python for proof/sleeve assets and once through Blender for
the UV-aligned front/back side-panel masks:

  python3 scripts/build_agi1011_assets.py
  blender -b --python scripts/build_agi1011_assets.py -- --blender
"""

from pathlib import Path
import shutil
import sys


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public" / "uniform"


def build_proof_assets():
    from PIL import Image, ImageFilter

    body = (255, 0, 0)
    body_accent = (255, 0, 255)
    old_stripe = (255, 0, 255)

    for view in ("front", "back"):
        src = Image.open(PUBLIC / f"agi-1012-proof-mask-{view}.png").convert("RGBA")
        out = Image.new("RGBA", src.size, (0, 0, 0, 0))
        source = src.load()
        target = out.load()
        width, height = src.size

        for y in range(height):
            # The insert begins at the underarm and tapers gently toward the
            # hem, matching AGI-1011's vertical black side construction.
            inner_left = 143 - max(0, y - 145) * 0.020
            inner_right = width - inner_left
            for x in range(width):
                r, g, b, a = source[x, y]
                if a < 16:
                    continue
                rgb = (r, g, b)
                # AGI-1011 has no chest bar; it uses a clean cyan front.
                if rgb == old_stripe:
                    rgb = body
                if y >= 145 and rgb == body and (x < inner_left or x > inner_right):
                    rgb = body_accent
                target[x, y] = (*rgb, a)

        out.save(PUBLIC / f"agi-1011-proof-mask-{view}.png", optimize=True)
        shutil.copy2(PUBLIC / f"agi-1012-proof-base-{view}.png", PUBLIC / f"agi-1011-proof-base-{view}.png")

    # The AGI-1011 cuff tracks the sleeve opening just like the approved 1012
    # band. Keeping the exact UV panel boundary avoids a fuzzy approximation.
    shutil.copy2(PUBLIC / "agi-1012-sleeve-left-mask.png", PUBLIC / "agi-1011-sleeve-left-mask.png")
    shutil.copy2(PUBLIC / "agi-1012-sleeve-right-mask.png", PUBLIC / "agi-1011-sleeve-right-mask.png")

    # The mask is authored from the garment's 3D surface coordinates. Smooth
    # the raster contour across adjacent UV triangles so the final sublimated
    # break reads as one clean sewn-panel curve at a true side view.
    for name in ("body-front", "body-back"):
        path = PUBLIC / f"agi-1011-{name}-mask.png"
        if not path.exists():
            continue
        mask = Image.open(path).convert("L").filter(ImageFilter.GaussianBlur(26))
        mask = mask.point(lambda value: 255 if value >= 128 else 0)
        mask.save(path, optimize=True)


def raster_body_mask(obj, output_path, size=2048, shared_bounds=None):
    import bpy
    import numpy as np

    mesh = obj.data
    mesh.calc_loop_triangles()
    uv_layer = mesh.uv_layers.active.data
    xs = np.array([v.co.x for v in mesh.vertices], dtype=np.float32)
    zs = np.array([v.co.z for v in mesh.vertices], dtype=np.float32)
    if shared_bounds:
        x_min, x_max, z_min, z_max = shared_bounds
    else:
        x_min, x_max = float(xs.min()), float(xs.max())
        z_min, z_max = float(zs.min()), float(zs.max())
    cx = (x_min + x_max) * 0.5
    half_width = max((x_max - x_min) * 0.5, 1e-5)
    height = max(z_max - z_min, 1e-5)
    mask = np.zeros((size, size), dtype=np.float32)

    for tri in mesh.loop_triangles:
        loops = list(tri.loops)
        uv = np.array([[uv_layer[i].uv.x, uv_layer[i].uv.y] for i in loops], dtype=np.float32)
        if np.ptp(uv[:, 0]) > 0.75 or np.ptp(uv[:, 1]) > 0.75:
            continue
        px = uv[:, 0] * (size - 1)
        py = uv[:, 1] * (size - 1)
        min_x = max(0, int(np.floor(px.min())))
        max_x = min(size - 1, int(np.ceil(px.max())))
        min_y = max(0, int(np.floor(py.min())))
        max_y = min(size - 1, int(np.ceil(py.max())))
        if min_x > max_x or min_y > max_y:
            continue
        gx, gy = np.meshgrid(np.arange(min_x, max_x + 1, dtype=np.float32) + 0.5,
                             np.arange(min_y, max_y + 1, dtype=np.float32) + 0.5)
        denom = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2])
        if abs(float(denom)) < 1e-8:
            continue
        w0 = ((py[1] - py[2]) * (gx - px[2]) + (px[2] - px[1]) * (gy - py[2])) / denom
        w1 = ((py[2] - py[0]) * (gx - px[2]) + (px[0] - px[2]) * (gy - py[2])) / denom
        w2 = 1.0 - w0 - w1
        inside = (w0 >= -0.001) & (w1 >= -0.001) & (w2 >= -0.001)
        if not inside.any():
            continue
        vids = [mesh.loops[i].vertex_index for i in loops]
        vx = np.array([mesh.vertices[i].co.x for i in vids], dtype=np.float32)
        vz = np.array([mesh.vertices[i].co.z for i in vids], dtype=np.float32)
        local_x = w0 * vx[0] + w1 * vx[1] + w2 * vx[2]
        local_z = w0 * vz[0] + w1 * vz[1] + w2 * vz[2]
        zn = (local_z - z_min) / height
        xn = np.abs(local_x - cx) / half_width
        # Start below the armhole. The inner seam widens subtly toward the hem
        # so the insert reads vertical from the front but remains substantial at
        # the side view, as in the original AGI-1011 artwork.
        edge = 0.72 - (1.0 - np.clip(zn, 0, 1)) * 0.07
        accent = inside & (zn < 0.79) & (xn > edge)
        region = mask[min_y:max_y + 1, min_x:max_x + 1]
        region[accent] = 1.0

    rgba = np.zeros((size, size, 4), dtype=np.float32)
    rgba[:, :, :3] = mask[:, :, None]
    rgba[:, :, 3] = 1.0
    image = bpy.data.images.new(output_path.stem, width=size, height=size, alpha=True)
    image.pixels.foreach_set(rgba.reshape(-1))
    image.filepath_raw = str(output_path)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def build_uv_assets():
    import bpy

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(PUBLIC / "agi-1012-jersey.glb"))
    objects = {obj.name.lower(): obj for obj in bpy.context.scene.objects if obj.type == "MESH"}
    for name in ("body_front", "body_back"):
        if name not in objects:
            raise RuntimeError(f"Missing {name} in soccer foundation")
    body_objects = [objects["body_front"], objects["body_back"]]
    all_x = [v.co.x for obj in body_objects for v in obj.data.vertices]
    all_z = [v.co.z for obj in body_objects for v in obj.data.vertices]
    bounds = (min(all_x), max(all_x), min(all_z), max(all_z))
    for name in ("body_front", "body_back"):
        raster_body_mask(objects[name], PUBLIC / f"agi-1011-{name.replace('_', '-')}-mask.png", shared_bounds=bounds)


if __name__ == "__main__":
    if "--blender" in sys.argv:
        build_uv_assets()
    else:
        build_proof_assets()
