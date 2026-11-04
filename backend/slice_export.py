"""Sample the full-resolution atlas on a slice plane and export it as an SVG.

The plane comes from the browser (vtk.js) in atlas µm:
    center  a point on the plane
    right   unit vector pointing right on screen
    up      unit vector pointing up on screen

Region outlines follow the voxel edges exactly (no smoothing). The only
clean-up is dropping points in the middle of straight runs, which doesn't
change the shape. Each region's fill colour is its ontology ID (#RRGGBB = ID),
so regions can be identified by colour after any Inkscape transform.
"""

import base64
import json
from collections import defaultdict

import numpy as np

# Unit steps between pixel corners, indexed by direction code.
RIGHT, DOWN, LEFT, UP = 0, 1, 2, 3
STEP = {RIGHT: (1, 0), DOWN: (0, 1), LEFT: (-1, 0), UP: (0, -1)}


# ---------------------------------------------------------------------------
# 1. Sampling the volume on the plane
# ---------------------------------------------------------------------------

def plane_extent(shape, voxel_um, center, right, up):
    """How far the plane must reach (µm from `center`) to cover the whole volume.

    Uses the 8 corner voxel centres, so with no tilt the samples land exactly
    on voxel centres.
    """
    corners = np.array(
        [[x, y, z] for x in (0, shape[0] - 1) for y in (0, shape[1] - 1) for z in (0, shape[2] - 1)],
        dtype=float,
    ) * voxel_um
    offsets = corners - center
    along_right = offsets @ right
    along_up = offsets @ up
    return along_right.min(), along_right.max(), along_up.min(), along_up.max()


def sample_plane(volume, voxel_um, center, right, up):
    """Nearest-neighbour labels on the plane, one pixel per voxel.

    Returns (labels, info): labels is a 2D array with row 0 at the top of the
    screen; info records where pixel (0, 0) sits so the SVG can be mapped back
    to atlas space later.
    """
    center, right, up = (np.asarray(v, dtype=float) for v in (center, right, up))
    right_min, right_max, up_min, up_max = plane_extent(volume.shape, voxel_um, center, right, up)

    width = int(np.floor((right_max - right_min) / voxel_um)) + 1
    height = int(np.floor((up_max - up_min) / voxel_um)) + 1

    # Position of every pixel along the plane's axes. Row 0 is the TOP, i.e. the largest "up".
    along_right = right_min + np.arange(width) * voxel_um
    along_up = up_max - np.arange(height) * voxel_um

    # Atlas position of every pixel → nearest voxel index.
    points = center + along_up[:, None, None] * up + along_right[None, :, None] * right
    voxel = np.rint(points / voxel_um).astype(np.int64)

    inside = np.all((voxel >= 0) & (voxel < volume.shape), axis=-1)
    labels = np.zeros((height, width), dtype=volume.dtype)
    labels[inside] = read_voxels(volume, voxel[inside])

    info = {
        "center_um": center.tolist(),
        "right": right.tolist(),
        "up": up.tolist(),
        "um_per_px": voxel_um,
        # Plane coordinates (µm along right / up from center) of the top-left pixel.
        "top_left_px_along_right_um": float(right_min),
        "top_left_px_along_up_um": float(up_max),
    }
    return labels, info


def read_voxels(volume, voxel):
    """Look up many voxels in the memory-mapped volume quickly.

    The file stores one coronal slice (fixed last index) as one continuous
    block. Picking scattered voxels straight from disk jumps all over the file
    and is very slow (~50 s for a sagittal slice), so instead we read each
    needed coronal slice in one go and pick the voxels out of it in memory.
    """
    values = np.empty(len(voxel), dtype=volume.dtype)
    z = voxel[:, 2]

    for slice_index in np.unique(z):
        wanted = voxel[z == slice_index]

        # Read only the rectangle of this coronal slice that the plane passes through.
        # A tilted plane only crosses a thin band of each slice, so this stays small.
        x0, y0 = wanted[:, 0].min(), wanted[:, 1].min()
        x1, y1 = wanted[:, 0].max() + 1, wanted[:, 1].max() + 1
        block = np.asarray(volume[x0:x1, y0:y1, slice_index])

        values[z == slice_index] = block[wanted[:, 0] - x0, wanted[:, 1] - y0]
    return values


# ---------------------------------------------------------------------------
# 2. Tracing exact region outlines
# ---------------------------------------------------------------------------

def boundary_edges(labels):
    """Every pixel edge between two different labels, as directed edges.

    Each edge is listed once for each side that isn't background, walked so
    that its region is on the LEFT (screen coordinates, y down). Corner (x, y)
    is the top-left corner of pixel (x, y).

    Returns arrays: label, start_x, start_y, direction.
    """
    height, width = labels.shape
    padded = np.pad(labels, 1)  # outside the image counts as background (0)

    pieces = []

    # Horizontal edges: corner row y, between pixel above and pixel below.
    above = padded[:-1, 1:-1]  # shape (height + 1, width)
    below = padded[1:, 1:-1]
    ys, xs = np.nonzero(above != below)
    # Walking right keeps the pixel above on the left; walking left keeps the one below.
    pieces.append((above[ys, xs], xs, ys, RIGHT))
    pieces.append((below[ys, xs], xs + 1, ys, LEFT))

    # Vertical edges: corner column x, between pixel on the left and on the right.
    left = padded[1:-1, :-1]  # shape (height, width + 1)
    right = padded[1:-1, 1:]
    ys, xs = np.nonzero(left != right)
    # Walking down keeps the right-hand pixel on the left; walking up keeps the left-hand one.
    pieces.append((right[ys, xs], xs, ys, DOWN))
    pieces.append((left[ys, xs], xs, ys + 1, UP))

    label = np.concatenate([p[0] for p in pieces])
    start_x = np.concatenate([p[1] for p in pieces])
    start_y = np.concatenate([p[2] for p in pieces])
    direction = np.concatenate([np.full(len(p[1]), p[3]) for p in pieces])

    not_background = label != 0
    return label[not_background], start_x[not_background], start_y[not_background], direction[not_background]


def chain_into_rings(start_x, start_y, direction):
    """Join one region's edges into closed rings, keeping only the corners.

    Every edge has the region on its left, so following edges end-to-start
    always closes a loop (outer outlines and holes). A point is kept only where
    the direction changes, which drops the points in the middle of straight runs.
    """
    # Unused edges leaving each corner.
    leaving = defaultdict(list)
    for x, y, d in zip(start_x.tolist(), start_y.tolist(), direction.tolist()):
        leaving[(x, y)].append(d)

    rings = []
    for start in list(leaving):
        while leaving[start]:
            ring = trace_one_ring(start, leaving)
            rings.append(ring)
    return rings


def trace_one_ring(start, leaving):
    """Follow edges from `start` until back at `start`. Returns the corner points."""
    corners = []  # (point, direction leaving it)
    point = start
    while True:
        d = leaving[point].pop()
        corners.append((point, d))
        dx, dy = STEP[d]
        point = (point[0] + dx, point[1] + dy)
        if point == start:
            break

    # Keep a point only if the path turns there (compare with the edge arriving at it).
    kept = []
    for i, (p, d) in enumerate(corners):
        arriving = corners[i - 1][1]  # i - 1 wraps around for the first point
        if d != arriving:
            kept.append(p)
    return kept


def region_rings(labels):
    """{label: [ring, ...]} for every non-background label in the image."""
    label, start_x, start_y, direction = boundary_edges(labels)

    rings = {}
    order = np.argsort(label, kind="stable")
    label, start_x, start_y, direction = label[order], start_x[order], start_y[order], direction[order]

    # Split the sorted edges into one group per label.
    unique_labels, first_index = np.unique(label, return_index=True)
    bounds = list(first_index) + [len(label)]
    for i, region in enumerate(unique_labels.tolist()):
        group = slice(bounds[i], bounds[i + 1])
        rings[region] = chain_into_rings(start_x[group], start_y[group], direction[group])
    return rings


# ---------------------------------------------------------------------------
# 3. Writing the SVG
# ---------------------------------------------------------------------------

def ring_to_path_data(ring):
    (x0, y0), *rest = ring
    return f"M{x0},{y0}" + "".join(f"L{x},{y}" for x, y in rest) + "Z"


def id_to_hex(ontology_id):
    if not 0 < ontology_id < 2**24:
        raise ValueError(f"ID {ontology_id} does not fit in a #RRGGBB colour")
    return f"#{ontology_id:06x}"


def region_layers(labels):
    """One Inkscape layer per region: exact outlines, filled with the region's ID colour."""
    layers = []
    for ontology_id, rings in sorted(region_rings(labels).items()):
        path_data = "".join(ring_to_path_data(r) for r in rings)
        layers.append(
            f'<g inkscape:groupmode="layer" inkscape:label="{ontology_id}">'
            f'<path d="{path_data}" fill="{id_to_hex(ontology_id)}" fill-opacity="0.4" '
            f'fill-rule="evenodd" stroke="#000" stroke-width="0.3"/>'
            f"</g>"
        )
    return layers


def metadata_element(data):
    """Everything needed to map the (later warped) SVG back to atlas space, as JSON."""
    text = json.dumps(data).replace("&", "&amp;").replace("<", "&lt;")
    return f'<metadata id="atlas-slice">{text}</metadata>'


SVG_OPEN = (
    '<svg xmlns="http://www.w3.org/2000/svg" '
    'xmlns:xlink="http://www.w3.org/1999/xlink" '
    'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" '
)


def build_svg(labels, info, title):
    """The atlas slice on its own, in its own coordinates (1 unit = 1 atlas pixel)."""
    height, width = labels.shape
    um_per_px = info["um_per_px"]

    return "\n".join([
        SVG_OPEN
        + f'width="{width * um_per_px / 1000}mm" height="{height * um_per_px / 1000}mm" '
        + f'viewBox="0 0 {width} {height}">',
        f"<title>{title}</title>",
        metadata_element(info),
        *region_layers(labels),
        "</svg>",
    ])


# ---------------------------------------------------------------------------
# 4. Aligned export: atlas placed on the tissue, exactly as set in the app
# ---------------------------------------------------------------------------

def svg_to_plane_matrix(info):
    """Atlas SVG coordinates → plane µm (along right / up from the plane centre).

    SVG coordinates are pixel CORNERS; info gives the CENTRE of the top-left
    pixel, half a pixel in. "Up" on the plane is "down" in SVG.
    """
    um = info["um_per_px"]
    right0 = info["top_left_px_along_right_um"]
    up0 = info["top_left_px_along_up_um"]
    return [um, 0, 0, -um, right0 - um / 2, up0 + um / 2]


def multiply(first, second):
    """Combine two SVG affine matrices [a, b, c, d, e, f]: apply `second`, then `first`."""
    a1, b1, c1, d1, e1, f1 = first
    a2, b2, c2, d2, e2, f2 = second
    return [
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    ]


def build_aligned_svg(labels, info, title, preview_png, preview_info, plane_to_preview):
    """Tissue preview as the background layer, atlas regions on top in the user's alignment.

    The document's coordinates are tissue preview pixels, sized in real mm, so
    after warping in Inkscape the outlines line up directly with the tissue image.
    """
    width, height = preview_info["width"], preview_info["height"]
    um_per_px = preview_info["umPerPx"]

    svg_to_preview = multiply(plane_to_preview, svg_to_plane_matrix(info))
    matrix = ",".join(f"{v:.9g}" for v in svg_to_preview)

    if um_per_px:
        size = f'width="{width * um_per_px / 1000}mm" height="{height * um_per_px / 1000}mm" '
    else:
        size = f'width="{width}" height="{height}" '  # tissue file had no pixel size

    image = base64.b64encode(preview_png).decode("ascii")
    metadata = {
        **info,
        "tissue": preview_info,
        "plane_to_tissue_px": plane_to_preview,
        "atlas_svg_to_tissue_px": svg_to_preview,
    }

    return "\n".join([
        SVG_OPEN + size + f'viewBox="0 0 {width} {height}">',
        f"<title>{title}</title>",
        metadata_element(metadata),
        # Background: the tissue, at true size.
        '<g inkscape:groupmode="layer" inkscape:label="Tissue">'
        + f'<image width="{width}" height="{height}" preserveAspectRatio="none" '
        + f'xlink:href="data:image/png;base64,{image}"/></g>',
        # On top: the atlas regions, placed exactly as aligned in the app.
        f'<g inkscape:groupmode="layer" inkscape:label="Atlas" transform="matrix({matrix})">',
        *region_layers(labels),
        "</g>",
        "</svg>",
    ])
