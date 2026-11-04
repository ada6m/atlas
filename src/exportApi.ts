/**
 * Ask the Python backend to export the current slice as an SVG.
 *
 * Only the plane's maths is sent. Python samples the full 10 µm atlas on that
 * plane, traces exact region outlines and returns the finished SVG.
 */

import { backendFetch } from "./backend";
import type { SlicePlane } from "./slicePlane";

/** Where the user placed the atlas on their tissue image (see AtlasOverlay). */
export interface Alignment {
  omePath: string; // tissue image the atlas was aligned on
  umPerPx: number; // resolution of that tissue preview
  planeToPreview: number[]; // [a, b, c, d, e, f]: plane µm → tissue preview pixels
}

/**
 * Without an alignment: the atlas slice on its own.
 * With one: the tissue preview as background, atlas regions on top exactly as aligned.
 */
export async function requestSliceSvg(plane: SlicePlane, title: string, alignment: Alignment | null): Promise<string> {
  const response = await backendFetch("/api/export-slice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      center: plane.center,
      right: plane.right,
      up: plane.up,
      title,
      alignment: alignment && {
        ome_path: alignment.omePath,
        um_per_px: alignment.umPerPx,
        plane_to_preview: alignment.planeToPreview,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Export failed (${response.status}): ${await response.text()}`);
  }
  return response.text();
}

export function downloadText(filename: string, text: string, mimeType: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: mimeType }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
