import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import Moveable from "react-moveable";
import type { SliceLabels } from "../slicePipeline";
import { type OverlayStyle, sliceToImage } from "../overlayImage";

export interface AtlasOverlayHandle {
  /** Undo all moving, scaling, rotating and flipping. */
  reset(): void;
  /** Mirror the atlas left–right (for sections mounted the other way round). */
  flip(): void;
  /**
   * The current alignment as one 2D affine matrix [a, b, c, d, e, f] (SVG order)
   * that maps a point on the atlas plane (µm along right / up from the plane's
   * centre) to tissue preview pixels — including every move, scale, rotate and flip.
   */
  planeToPreviewMatrix(): number[];
}

interface Props {
  visible: boolean; // hidden overlays keep their alignment
  slice: SliceLabels;
  style: OverlayStyle;
  opacity: number; // 0–1
  previewWidth: number; // px, size of the tissue preview the overlay sits on
  previewHeight: number;
  previewUmPerPx: number | null; // null if the tissue file has no pixel size
  stageScale: number; // current on-screen zoom of the preview, so handles keep a constant size
}

/**
 * The current atlas slice drawn over the tissue preview, at true physical size,
 * inside a box that can be dragged, scaled (Shift keeps proportions) and rotated.
 */
const AtlasOverlay = forwardRef<AtlasOverlayHandle, Props>(function AtlasOverlay(props, ref) {
  const { visible, slice, style, opacity, previewWidth, previewHeight, previewUmPerPx, stageScale } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const moveable = useRef<Moveable>(null);

  // Size of the atlas slice in preview pixels. Both images know their µm per pixel,
  // so the atlas starts at the right physical size. Without a pixel size, fit it to the image.
  const scale = previewUmPerPx ? slice.umPerPx / previewUmPerPx : (0.9 * previewWidth) / slice.width;
  const width = slice.width * scale;
  const height = slice.height * scale;
  const left = (previewWidth - width) / 2; // start centred on the tissue
  const top = (previewHeight - height) / 2;

  // Redraw whenever the slice, tilt or style changes.
  useEffect(() => {
    const c = canvas.current!;
    c.width = slice.width;
    c.height = slice.height;
    c.getContext("2d")!.putImageData(sliceToImage(slice, style), 0, 0);
    moveable.current?.updateRect(); // the box may have changed size
  }, [slice, style]);

  // The preview was panned or zoomed: keep the handles lined up.
  useEffect(() => {
    moveable.current?.updateRect();
  }, [stageScale]);

  useImperativeHandle(ref, () => ({
    reset() {
      box.current!.style.transform = "";
      moveable.current?.updateRect();
    },
    flip() {
      box.current!.style.transform += " scaleX(-1)";
      moveable.current?.updateRect();
    },
    planeToPreviewMatrix() {
      // 1. Plane µm → box pixels. Pixel centres sit half a pixel in from the box edge,
      //    and "up" on the plane is "down" in pixel rows.
      const pxPerUm = scale / slice.umPerPx;
      const planeToBox = new DOMMatrix([
        pxPerUm,
        0,
        0,
        -pxPerUm,
        -slice.firstColumnRightUm * pxPerUm + scale / 2,
        slice.firstRowUpUm * pxPerUm + scale / 2,
      ]);

      // 2. Box pixels → preview pixels: the box's position plus Moveable's transform,
      //    which CSS applies around the box's centre.
      const userTransform = new DOMMatrix(getComputedStyle(box.current!).transform);
      const boxToPreview = new DOMMatrix()
        .translate(left + width / 2, top + height / 2)
        .multiply(userTransform)
        .translate(-width / 2, -height / 2);

      const m = boxToPreview.multiply(planeToBox);
      return [m.a, m.b, m.c, m.d, m.e, m.f];
    },
  }));

  return (
    <>
      <div
        ref={box}
        className="atlas-overlay"
        style={{ left, top, width, height, visibility: visible ? "visible" : "hidden" }}
      >
        <canvas ref={canvas} style={{ opacity }} />
      </div>

      {visible && (
      <Moveable
        ref={moveable}
        target={box}
        draggable
        scalable
        rotatable
        keepRatio={false}
        zoom={1 / stageScale}
        origin={false}
        onDrag={(e) => {
          e.target.style.transform = e.transform;
        }}
        onScale={(e) => {
          e.target.style.transform = e.drag.transform;
        }}
        onRotate={(e) => {
          e.target.style.transform = e.drag.transform;
        }}
      />
      )}
    </>
  );
});

export default AtlasOverlay;
