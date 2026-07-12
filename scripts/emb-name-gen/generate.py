#!/usr/bin/env python3
"""Generate per-piece embroidery DSTs from an emb-name-gen payload via Ink/Stitch.

Runs in CI (see .github/workflows/emb-name-gen.yml). Consumes the plan produced
by src/embNameGen.js buildEmbNameGen():

    {"job_id": "JOB-1189-04", "fingerprint": "ab12cd34",
     "pieces": [{"seq":1,"size":"L","kind":"name","text":"Smith",
                 "font":"block","heightIn":1,"filename":"001-L-NAME-SMITH"}, ...]}

For each piece it invokes Ink/Stitch's batch_lettering extension headlessly
(one call per piece — our sew-order filenames replace batch_lettering's own
000-XXXX naming), unzips the stdout zip, validates the DST, and writes it to
out/<filename>.DST. Writes out/manifest.json with per-piece results; exits
non-zero if any piece failed (manifest still written for diagnosis).

Stdlib only. Env: INKSTITCH_BIN (path to the bundled inkstitch executable).
With no payload (or {"selftest": true}) it runs a built-in selftest: one name
and one number through the default font — the first-live-run validation.
"""

import io
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.abspath(os.environ.get("EMB_OUT_DIR", "out"))
MIN_DST_BYTES = 200  # an empty/failed render produces a near-empty file; real lettering is KBs

SELFTEST_PAYLOAD = {
    "job_id": "SELFTEST",
    "fingerprint": "selftest",
    "pieces": [
        {"seq": 1, "size": "L", "kind": "name", "text": "SMITH", "font": "block", "heightIn": 1, "filename": "001-L-NAME-SMITH"},
        {"seq": 2, "size": "L", "kind": "number", "text": "12", "font": "block", "heightIn": 1, "filename": "002-L-NUM-12"},
    ],
}

BLANK_SVG = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="100mm" height="100mm" viewBox="0 0 100 100" version="1.1"></svg>
"""


def log(msg):
    print(msg, flush=True)


def load_payload(argv):
    if len(argv) > 1 and os.path.exists(argv[1]):
        with open(argv[1]) as f:
            raw = f.read().strip()
        if raw:
            payload = json.loads(raw)
            if payload.get("pieces"):
                return payload, False
    log("No payload provided — running SELFTEST (one name + one number, default font)")
    return SELFTEST_PAYLOAD, True


def load_fonts_config():
    with open(os.path.join(HERE, "fonts.json")) as f:
        cfg = json.load(f)
    return {k: v for k, v in cfg.items() if not k.startswith("_")}, cfg.get("_default", "block")


def resolve_font(font_key, fonts_cfg, default_key, bundle_fonts_dir, warnings):
    cfg = fonts_cfg.get(font_key)
    if cfg is None:
        warnings.append(f'font "{font_key}" not configured — using default "{default_key}"')
        cfg = fonts_cfg[default_key]
    # Read the bundle's own font.json for the EXACT display name (case varies by release).
    name = cfg["fallbackName"]
    fj = os.path.join(bundle_fonts_dir, cfg["fontDir"], "font.json")
    if os.path.exists(fj):
        try:
            with open(fj) as f:
                meta = json.load(f)
            if meta.get("name"):
                name = meta["name"]
        except Exception as e:  # noqa: BLE001 — fall back to configured name, but say so
            warnings.append(f'could not read {fj} ({e}) — using fallback name "{name}"')
    else:
        warnings.append(f'font dir "{cfg["fontDir"]}" not in bundle — using fallback name "{name}"')
    return name, cfg


def scale_for_height(height_in, cfg, warnings):
    want_mm = float(height_in) * 25.4
    pct = round(want_mm / cfg["designHeightMm"] * 100)
    clamped = max(cfg["minScalePct"], min(cfg["maxScalePct"], pct))
    if clamped != pct:
        got_mm = cfg["designHeightMm"] * clamped / 100
        warnings.append(
            f'requested {height_in}" ({want_mm:.1f}mm) is outside this font\'s range — '
            f'clamped to {clamped}% = {got_mm:.1f}mm ({got_mm / 25.4:.2f}")'
        )
    return clamped


def _find_logs():
    """Ink/Stitch writes errors to a log file (it suppresses stderr). Collect any."""
    out = []
    for base in [os.path.expanduser("~/.config/inkstitch"), os.path.expanduser("~/.inkstitch"), os.getcwd()]:
        if not os.path.isdir(base):
            continue
        for root, _dirs, files in os.walk(base):
            for fn in files:
                if fn.endswith(".log") or "inkstitch" in fn.lower() and fn.endswith(".txt"):
                    p = os.path.join(root, fn)
                    try:
                        with open(p, errors="replace") as f:
                            out.append(f"--- {p} ---\n{f.read()[-3000:]}")
                    except Exception:  # noqa: BLE001
                        pass
    return "\n".join(out)


def run_inkstitch(bin_path, text, font_name, scale_pct, blank_svg_path):
    """One batch_lettering call -> (zip_bytes, stderr_text, returncode).

    stderr is inherited (flows to CI logs) rather than captured, because
    Ink/Stitch suppresses much of its own stderr; we surface its log file on
    failure instead. stdout (the zip) is captured to a temp file to keep binary
    bytes clean.
    """
    cmd = [
        bin_path,
        "--extension=batch_lettering",
        f"--text={text}",
        f"--font={font_name}",
        f"--scale={scale_pct}",
        "--color-sort=off",
        "--trim=off",
        "--file-formats=dst",
        blank_svg_path,
    ]
    if shutil.which("xvfb-run"):
        cmd = ["xvfb-run", "-a"] + cmd
    zip_path = blank_svg_path + ".out.zip"
    with open(zip_path, "wb") as zf:
        proc = subprocess.run(cmd, stdout=zf, stderr=subprocess.PIPE, timeout=300)
    with open(zip_path, "rb") as zf:
        zip_bytes = zf.read()
    stderr = proc.stderr.decode("utf-8", "replace")
    if proc.returncode != 0 or not zip_bytes:
        logtext = _find_logs()
        if logtext:
            stderr = (stderr + "\n[inkstitch log files]\n" + logtext).strip()
    return zip_bytes, stderr, proc.returncode


def extract_dst(zip_bytes):
    """Pull the first .dst out of batch_lettering's stdout zip -> bytes.

    On an import-time crash Ink/Stitch prints the Python traceback to STDOUT
    (not stderr) — so if the bytes aren't a zip, surface them as the error.
    """
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile:
        text = zip_bytes[:1200].decode("utf-8", "replace")
        raise RuntimeError(f"stdout was not a zip — inkstitch output:\n{text}")
    with zf as z:
        dsts = [n for n in z.namelist() if n.lower().endswith(".dst")]
        if not dsts:
            raise ValueError(f"zip contained no .dst (members: {z.namelist()})")
        return z.read(dsts[0])


def main(argv):
    bin_path = os.environ.get("INKSTITCH_BIN", "")
    if not bin_path or not os.path.exists(bin_path):
        log(f"FATAL: INKSTITCH_BIN not set or missing (got: {bin_path!r})")
        return 2
    # Fonts dir: prefer the explicitly discovered one (the v3.2.2 tarball puts the
    # binary at inkstitch/bin/inkstitch but fonts at inkstitch/fonts), then try
    # both layouts relative to the binary.
    bin_dir = os.path.dirname(os.path.abspath(bin_path))
    candidates = [os.environ.get("EMB_FONTS_DIR", ""),
                  os.path.join(bin_dir, "fonts"),
                  os.path.join(os.path.dirname(bin_dir), "fonts")]
    bundle_fonts_dir = next((c for c in candidates if c and os.path.isdir(c)), candidates[1])

    os.makedirs(OUT_DIR, exist_ok=True)
    try:
        payload, is_selftest = load_payload(argv)
    except Exception as e:  # noqa: BLE001 — malformed payload; write a fatal manifest, don't traceback
        log(f"FATAL: payload is not valid JSON: {e}")
        with open(os.path.join(OUT_DIR, "manifest.json"), "w") as f:
            json.dump({"ok": False, "fatal": f"payload parse error: {e}", "pieces": []}, f, indent=2)
        return 2
    fonts_cfg, default_key = load_fonts_config()

    blank_svg_path = os.path.join(OUT_DIR, "_blank.svg")
    with open(blank_svg_path, "w") as f:
        f.write(BLANK_SVG)

    results = []
    failed = 0
    for piece in payload["pieces"]:
        fname = piece.get("filename")
        if not fname:
            results.append({"filename": "(missing)", "seq": piece.get("seq"), "kind": piece.get("kind"),
                             "text": piece.get("text"), "ok": False, "warnings": [],
                             "error": "piece missing required 'filename'"})
            failed += 1
            continue
        warnings = []
        entry = {"filename": fname, "seq": piece.get("seq"), "kind": piece.get("kind"),
                 "text": piece.get("text"), "ok": False, "warnings": warnings}
        results.append(entry)
        try:
            raw_t = piece.get("text")
            text = "" if raw_t is None else re.sub(r"\s+", " ", str(raw_t)).strip()
            if not text:
                raise ValueError("empty text")
            font_name, cfg = resolve_font(piece.get("font") or default_key, fonts_cfg, default_key,
                                          bundle_fonts_dir, warnings)
            if piece.get("fontDefaulted"):
                warnings.append('font was defaulted upstream (names carry no font field yet)')
            raw_h = piece.get("heightIn")
            try:
                h_valid = raw_h not in (None, "") and float(raw_h) > 0
            except (TypeError, ValueError):
                h_valid = False
            if h_valid:
                height_in = raw_h
            else:
                warnings.append(f'heightIn missing/invalid ({raw_h!r}) — defaulted to 1"')
                height_in = 1
            pct = scale_for_height(height_in, cfg, warnings)
            entry.update({"font": font_name, "scalePct": pct,
                          "heightMm": round(cfg["designHeightMm"] * pct / 100, 1)})
            log(f'[{fname}] "{text}" font="{font_name}" scale={pct}%')

            zip_bytes, stderr, rc = run_inkstitch(bin_path, text, font_name, pct, blank_svg_path)
            if rc != 0 or not zip_bytes:
                # Crashes print the traceback to STDOUT, so include both streams.
                out_txt = zip_bytes[:1200].decode("utf-8", "replace") if zip_bytes else "(empty)"
                raise RuntimeError(f"inkstitch rc={rc}; stdout:\n{out_txt}\nstderr tail:\n{stderr[-1000:]}")
            dst = extract_dst(zip_bytes)
            if len(dst) < MIN_DST_BYTES:
                raise RuntimeError(f"DST suspiciously small ({len(dst)} bytes) — likely empty render; "
                                   f"stderr tail:\n{stderr[-1000:]}")
            out_path = os.path.join(OUT_DIR, fname + ".DST")
            with open(out_path, "wb") as f:
                f.write(dst)
            entry.update({"ok": True, "bytes": len(dst)})
            log(f'  -> OK {len(dst)} bytes' + (f' ({len(warnings)} warning(s))' if warnings else ""))
            for w in warnings:
                log(f"  ! {w}")
        except Exception as e:  # noqa: BLE001 — keep going; report all failures at the end
            failed += 1
            entry["error"] = str(e)
            log(f"  -> FAILED: {e}")

    manifest = {"job_id": payload.get("job_id"), "fingerprint": payload.get("fingerprint"),
                "selftest": is_selftest, "pieces": results,
                "ok": failed == 0, "failed": failed, "total": len(results)}
    with open(os.path.join(OUT_DIR, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    log(f"\n{len(results) - failed}/{len(results)} pieces generated -> {OUT_DIR}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
