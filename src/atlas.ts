/**
 * The 3D annotation volume and its three standard views.
 */

import * as nifti from "nifti-reader-js";

export type Vec3 = [number, number, number];
export type Axis = 0 | 1 | 2;
export type View = "coronal" | "sagittal" | "axial";

export interface Atlas {
  dims: Vec3; // voxels along each axis
  spacing: Vec3; // µm per voxel along each axis
  data: Uint16Array; // compact label index per voxel (x fastest); 0 = background
  ids: number[]; // compact label index → ontology ID
}

/**
 * Volume axes in this atlas file:
 *   0 = left → right
 *   1 = dorsal → ventral
 *   2 = anterior → posterior
 */

/** An axis plus a direction (+1 or -1). */
export type SignedAxis = { axis: Axis; sign: 1 | -1 };

export interface ViewLayout {
  normal: Axis; // the axis we slice along
  right: SignedAxis; // volume direction that points right on screen
  up: SignedAxis; // volume direction that points up on screen
}

export const VIEWS: Record<View, ViewLayout> = {
  // Seen from the front, dorsal up.
  coronal: { normal: 2, right: { axis: 0, sign: 1 }, up: { axis: 1, sign: -1 } },
  // Seen from the side, anterior left, dorsal up.
  sagittal: { normal: 0, right: { axis: 2, sign: 1 }, up: { axis: 1, sign: -1 } },
  // Seen from above, anterior up.
  axial: { normal: 1, right: { axis: 0, sign: 1 }, up: { axis: 2, sign: -1 } },
};

/** A signed axis as a 3D unit vector, e.g. { axis: 1, sign: -1 } → [0, -1, 0]. */
export function toVector({ axis, sign }: SignedAxis): Vec3 {
  const v: Vec3 = [0, 0, 0];
  v[axis] = sign;
  return v;
}

export function sliceCount(atlas: Atlas, view: View): number {
  return atlas.dims[VIEWS[view].normal];
}

// Each atlas is loaded at most once, however many times it is asked for. (In
// development React deliberately runs start-up code twice, which would
// otherwise unpack two 320 MB copies at the same time.)
const loadedAtlases = new Map<string, Promise<Atlas>>();

/** Load the annotation (.nii or .nii.gz) and its label → ontology ID table. */
export function loadAtlas(volumeUrl: string, labelsUrl: string): Promise<Atlas> {
  const key = `${volumeUrl}|${labelsUrl}`;
  if (!loadedAtlases.has(key)) {
    loadedAtlases.set(key, readAtlas(volumeUrl, labelsUrl));
  }
  return loadedAtlases.get(key)!;
}

async function readAtlas(volumeUrl: string, labelsUrl: string): Promise<Atlas> {
  let buffer = await (await fetch(volumeUrl)).arrayBuffer();
  if (nifti.isCompressed(buffer)) {
    // Unpacks straight into one buffer (~330 MB peak). The browser's streaming
    // unpacker (decompressAsync) doesn't pause the page, but peaks near 1 GB.
    buffer = nifti.decompress(buffer) as ArrayBuffer;
  }

  const header = nifti.readHeader(buffer)!;
  const ids: number[] = await (await fetch(labelsUrl)).json();

  return {
    dims: header.dims.slice(1, 4) as Vec3,
    spacing: header.pixDims.slice(1, 4) as Vec3,
    data: labelsView(header, buffer),
    ids,
  };
}

/**
 * The voxel labels, read in place from the unpacked file (no 320 MB copy).
 * The reader's own readImage() copies them out; we just point at them instead.
 */
function labelsView(header: nifti.NIFTI1 | nifti.NIFTI2, buffer: ArrayBuffer): Uint16Array {
  const UINT16 = 512; // NIfTI datatype code
  if (header.datatypeCode !== UINT16 || !header.littleEndian) {
    throw new Error("Atlas must be a little-endian uint16 NIfTI (see backend/prepare_atlas.py)");
  }

  const [, x, y, z] = header.dims;
  return new Uint16Array(buffer, header.vox_offset, x * y * z);
}
