/**
 * Turn the current atlas slice into a see-through picture to lay over the tissue.
 *
 *   "filled"   every region in its display colour
 *   "outlines" only the borders between regions, in white
 *
 * Background is fully transparent in both.
 */

import { displayColor } from "./colors";
import type { SliceLabels } from "./slicePipeline";

export type OverlayStyle = "filled" | "outlines";

export function sliceToImage({ labels, width, height }: SliceLabels, style: OverlayStyle): ImageData {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const colorOf = colorLookup();

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      const label = labels[i];

      if (style === "filled") {
        if (label === 0) continue; // transparent background
        const [r, g, b] = colorOf(label);
        rgba.set([r, g, b, 255], i * 4);
      } else if (isBorderPixel(labels, width, height, col, row)) {
        rgba.set([255, 255, 255, 255], i * 4);
      }
    }
  }
  return new ImageData(rgba, width, height);
}

/** A pixel is on a border if its right or lower neighbour has a different label. */
function isBorderPixel(labels: Uint16Array, width: number, height: number, col: number, row: number): boolean {
  const label = labels[row * width + col];
  const right = col + 1 < width ? labels[row * width + col + 1] : 0;
  const below = row + 1 < height ? labels[(row + 1) * width + col] : 0;
  return label !== right || label !== below;
}

/** Display colours as 0–255 RGB, computed once per label. */
function colorLookup() {
  const cache = new Map<number, [number, number, number]>();
  return (label: number) => {
    if (!cache.has(label)) {
      const [r, g, b] = displayColor(label);
      cache.set(label, [r * 255, g * 255, b * 255]);
    }
    return cache.get(label)!;
  };
}
