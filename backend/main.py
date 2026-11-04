"""Backend API.

    /api/health         is the backend up?
    /api/export-slice   full-resolution (10 µm) atlas slice → SVG
    /api/ome/preview    .ome.tif path → downscaled colour PNG + its scale

The desktop app (src-tauri/src/lib.rs) starts this on a free port and stops it
on exit. To run it on its own, from the project root:
    backend/.venv/Scripts/python -m uvicorn main:app --app-dir backend --port 8000
(the plain-browser dev setup reaches it through Vite's /api proxy, see vite.config.ts).
"""

import json
import os
import sys
import threading
from functools import lru_cache
from pathlib import Path

import nibabel as nib
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

import ome
from slice_export import build_aligned_svg, build_svg, sample_plane

ANNOTATION_10UM = Path(__file__).parent / "data" / "DeMBA_P10_KimLabDevCCFv001_10um.nii"


def exit_when_app_closes():
    """When started by the desktop app, quit as soon as the app goes away.

    The app keeps a pipe open to our stdin. When the app exits — normally, by
    crashing, or by `tauri dev` restarting it — the pipe closes, reading
    returns, and we exit. This stops old backends piling up in the background.
    """
    if os.environ.get("ATLAS_EXIT_WITH_PARENT") != "1":
        return

    def watch():
        sys.stdin.read()  # blocks until the app's end of the pipe closes
        os._exit(0)

    threading.Thread(target=watch, daemon=True).start()


exit_when_app_closes()

app = FastAPI()

# The app's window is a different origin from this server, so allow it to call us:
# Vite during development (localhost:<port>) and the built app (tauri.localhost).
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(http://(localhost|127\.0\.0\.1)(:\d+)?|https?://tauri\.localhost|tauri://localhost)$",
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Preview-Info"],  # the page reads the preview's scale from this header
)

# Memory-map the 5 GB annotation: only the voxels a slice touches are read from disk.
annotation_image = nib.load(ANNOTATION_10UM, mmap=True)
annotation = np.asanyarray(annotation_image.dataobj)
voxel_um = float(annotation_image.header.get_zooms()[0])


@app.get("/api/health")
def health():
    return {"ok": True}


# ---------------------------------------------------------------------------
# Atlas slice export
# ---------------------------------------------------------------------------

class Alignment(BaseModel):
    """Where the user placed the atlas on their tissue (from the overlay in the app)."""

    ome_path: str  # the tissue image the atlas was aligned on
    um_per_px: float  # resolution of the preview it was aligned on
    plane_to_preview: list[float]  # SVG-order affine [a, b, c, d, e, f]: plane µm → preview px


class SlicePlaneRequest(BaseModel):
    center: list[float]  # µm, a point on the plane
    right: list[float]  # unit vector pointing right on screen
    up: list[float]  # unit vector pointing up on screen
    title: str = "atlas slice"
    alignment: Alignment | None = None  # if given: export on top of the tissue, as aligned


@app.post("/api/export-slice")
def export_slice(plane: SlicePlaneRequest):
    labels, info = sample_plane(annotation, voxel_um, plane.center, plane.right, plane.up)
    info["atlas"] = ANNOTATION_10UM.name

    if plane.alignment is None:
        svg = build_svg(labels, info, plane.title)
    else:
        a = plane.alignment
        png, preview_info = get_preview(a.ome_path, a.um_per_px)
        svg = build_aligned_svg(labels, info, plane.title, png, preview_info, a.plane_to_preview)

    return Response(content=svg, media_type="image/svg+xml")


# ---------------------------------------------------------------------------
# Microscopy image (.ome.tif)
# ---------------------------------------------------------------------------

class OmePreviewRequest(BaseModel):
    path: str
    um_per_px: float = 5.0  # preview resolution


@app.post("/api/ome/preview")
def ome_preview(request: OmePreviewRequest):
    """Downscaled colour PNG of the section. Its scale etc. comes back in the X-Preview-Info header."""
    png, info = get_preview(request.path, request.um_per_px)
    return Response(
        content=png,
        media_type="image/png",
        headers={"X-Preview-Info": json.dumps(info)},
    )


def get_preview(path_text, um_per_px):
    """The preview PNG and its info, made once and then reused (e.g. again at export)."""
    path = Path(path_text.strip().strip('"'))  # tolerate pasted paths with quotes
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    # The file's modification time is part of the cache key, so an edited file is re-read.
    return cached_preview(str(path), path.stat().st_mtime, um_per_px)


@lru_cache(maxsize=4)
def cached_preview(path, modified_time, um_per_px):
    try:
        png, info = ome.make_preview(Path(path), target_um_per_px=um_per_px)
    except Exception as error:  # unreadable / not an OME-TIFF
        raise HTTPException(status_code=400, detail=f"Could not read {Path(path).name}: {error}")

    info["fileName"] = Path(path).name
    return png, info
