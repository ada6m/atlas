/**
 * Region display colours, spread around the colour wheel so neighbours look
 * distinct. (Export colours are set in Python: the fill there IS the ontology ID.)
 */

const GOLDEN_ANGLE = 137.508; // degrees; consecutive labels land far apart on the wheel

/** RGB in 0–1 for the viewer. Label 0 (background) is black. */
export function displayColor(labelIndex: number): [number, number, number] {
  if (labelIndex === 0) return [0, 0, 0];
  const hue = (labelIndex * GOLDEN_ANGLE) % 360;
  return hslToRgb(hue, 0.55, 0.55);
}

/** Standard HSL → RGB conversion. h in degrees, s and l in 0–1. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const chroma = s * Math.min(l, 1 - l);

  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };

  return [channel(0), channel(8), channel(4)];
}
