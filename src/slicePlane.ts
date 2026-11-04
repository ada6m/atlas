/**
 * The cutting plane: where the slice is and how it is tilted.
 *
 * Everything is in atlas space, in µm (voxel index × voxel size). This plane is
 * the single source of truth: vtk.js uses it to draw the slice, and the same
 * numbers are sent to Python, which samples the full 10 µm atlas on it.
 */

import { type Atlas, type Vec3, type View, VIEWS, toVector } from "./atlas";

export interface Tilt {
  vertical: number; // degrees; tips the top edge of the section towards / away from you
  horizontal: number; // degrees; tips the left edge of the section towards / away from you
}

export interface SlicePlane {
  center: Vec3; // µm; the plane passes through this point and tilts around it
  right: Vec3; // unit vector pointing right on screen
  up: Vec3; // unit vector pointing up on screen
  normal: Vec3; // unit vector out of the screen (right × up)

  // How far the plane must extend (µm, measured from `center` along right/up)
  // to cover the whole volume.
  rightMin: number;
  rightMax: number;
  upMin: number;
  upMax: number;
}

const ANATOMICAL_AXIS_NAMES = ["Mediolateral", "Dorsoventral", "Anteroposterior"];

/**
 * Slider labels for the two tilts, named after the anatomical axis that runs
 * along the tipped edge. E.g. in a coronal view the vertical tilt is
 * "Dorsoventral": the dorsal edge moves anterior while the ventral edge moves
 * posterior (or vice versa).
 */
export function tiltNames(view: View): { vertical: string; horizontal: string } {
  const { right, up } = VIEWS[view];
  return {
    vertical: ANATOMICAL_AXIS_NAMES[up.axis],
    horizontal: ANATOMICAL_AXIS_NAMES[right.axis],
  };
}

/**
 * @param depthIndex slice number along the view's normal axis (atlas voxels)
 */
export function computeSlicePlane(atlas: Atlas, view: View, depthIndex: number, tilt: Tilt): SlicePlane {
  const layout = VIEWS[view];

  // The plane tilts around the middle of the brain at the chosen depth.
  const center = volumeCenter(atlas);
  center[layout.normal] = depthIndex * atlas.spacing[layout.normal];

  // Start from the untilted screen directions…
  let right = toVector(layout.right);
  let up = toVector(layout.up);

  // …tip the top edge (rotate around the screen's horizontal axis)…
  up = rotate(up, right, tilt.vertical);

  // …then tip the side edge (rotate around the new vertical axis).
  right = rotate(right, up, tilt.horizontal);

  const normal = cross(right, up);
  return { center, right, up, normal, ...planeExtent(atlas, center, right, up) };
}

/**
 * 4×4 matrix (column-major, as vtk.js expects) that maps plane coordinates
 * (x along right, y along up, z along normal; origin at `center`) to atlas µm.
 */
export function planeToAtlasMatrix({ center, right, up, normal }: SlicePlane): Float32Array {
  return new Float32Array([...right, 0, ...up, 0, ...normal, 0, ...center, 1]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Centre of the volume in µm (between the first and last voxel centres). */
function volumeCenter({ dims, spacing }: Atlas): Vec3 {
  return [0, 1, 2].map((axis) => ((dims[axis] - 1) * spacing[axis]) / 2) as Vec3;
}

/**
 * Project the 8 corners of the volume onto the plane to find how far it needs
 * to reach. With no tilt the corners land exactly on voxel centres, so the
 * drawn slice lines up with the voxel grid.
 */
function planeExtent({ dims, spacing }: Atlas, center: Vec3, right: Vec3, up: Vec3) {
  const extent = { rightMin: Infinity, rightMax: -Infinity, upMin: Infinity, upMax: -Infinity };

  for (const cornerX of [0, dims[0] - 1]) {
    for (const cornerY of [0, dims[1] - 1]) {
      for (const cornerZ of [0, dims[2] - 1]) {
        const offset: Vec3 = [
          cornerX * spacing[0] - center[0],
          cornerY * spacing[1] - center[1],
          cornerZ * spacing[2] - center[2],
        ];
        const alongRight = dot(offset, right);
        const alongUp = dot(offset, up);

        extent.rightMin = Math.min(extent.rightMin, alongRight);
        extent.rightMax = Math.max(extent.rightMax, alongRight);
        extent.upMin = Math.min(extent.upMin, alongUp);
        extent.upMax = Math.max(extent.upMax, alongUp);
      }
    }
  }
  return extent;
}

/** Rotate vector v around a unit axis by `degrees` (Rodrigues' rotation formula). */
function rotate(v: Vec3, axis: Vec3, degrees: number): Vec3 {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const axisCrossV = cross(axis, v);
  const axisDotV = dot(axis, v);

  return [0, 1, 2].map(
    (i) => v[i] * cos + axisCrossV[i] * sin + axis[i] * axisDotV * (1 - cos),
  ) as Vec3;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
