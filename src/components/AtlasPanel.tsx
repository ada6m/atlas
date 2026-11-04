import { useEffect, useRef, useState } from "react";
import { type Atlas, type View, loadAtlas, sliceCount } from "../atlas";
import { createSlicePipeline, type SliceLabels, type SlicePipeline } from "../slicePipeline";
import { createSliceViewer, type SliceViewer } from "../sliceViewer";
import { createSlicePreview3D, type SlicePreview3D } from "../slicePreview3D";
import { type Tilt, computeSlicePlane, tiltNames } from "../slicePlane";
import { type Alignment, downloadText, requestSliceSvg } from "../exportApi";

const ATLAS_URL = "/atlas/p10_annotation_20um.nii.gz";
const LABELS_URL = "/atlas/labels.json";

// Cryostat cutting errors are usually a few degrees; this leaves plenty of room.
const MAX_TILT_DEGREES = 15;
const NO_TILT: Tilt = { vertical: 0, horizontal: 0 };

const middleSlice = (atlas: Atlas, view: View) => Math.floor(sliceCount(atlas, view) / 2);

interface Props {
  /** Called with the current slice whenever view, slice or tilt changes, so the tissue panel can overlay it. */
  onSliceChange: (slice: SliceLabels) => void;
  /** The overlay alignment on the tissue, if any; used to export the atlas in place. */
  getAlignment: { current: () => Alignment | null };
}

export default function AtlasPanel({ onSliceChange, getAlignment }: Props) {
  const viewerContainer = useRef<HTMLDivElement>(null);
  const previewContainer = useRef<HTMLDivElement>(null);

  const pipeline = useRef<SlicePipeline | null>(null);
  const viewer = useRef<SliceViewer | null>(null);
  const preview = useRef<SlicePreview3D | null>(null);

  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [view, setView] = useState<View>("coronal");
  const [slice, setSlice] = useState(0);
  const [tilt, setTilt] = useState<Tilt>(NO_TILT);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [exportStatus, setExportStatus] = useState("");

  // Load the atlas once, starting on the middle coronal slice.
  useEffect(() => {
    loadAtlas(ATLAS_URL, LABELS_URL).then((loaded) => {
      setAtlas(loaded);
      setSlice(middleSlice(loaded, "coronal"));
    });
  }, []);

  // Build the vtk pipeline, the 2D viewer and the 3D preview once the atlas is loaded.
  useEffect(() => {
    if (!atlas) return;
    const p = createSlicePipeline(atlas);
    const v = createSliceViewer(viewerContainer.current!, p, setHoveredId);
    const p3d = createSlicePreview3D(previewContainer.current!, atlas, p);
    pipeline.current = p;
    viewer.current = v;
    preview.current = p3d;

    const onResize = () => {
      v.resize();
      p3d.resize();
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      v.destroy();
      p3d.destroy();
      pipeline.current = null;
      viewer.current = null;
      preview.current = null;
    };
  }, [atlas]);

  // Any change to view, slice or tilt: recompute the plane and redraw both views.
  useEffect(() => {
    if (!atlas || !pipeline.current) return;
    pipeline.current.setPlane(computeSlicePlane(atlas, view, slice, tilt));
    viewer.current?.render();
    preview.current?.update();
    onSliceChange(pipeline.current.currentSliceLabels());
  }, [atlas, view, slice, tilt, onSliceChange]);

  // Refit the 2D camera only when the view changes (not while scrolling or tilting).
  useEffect(() => {
    viewer.current?.fitToView();
    viewer.current?.render();
  }, [atlas, view]);

  function changeView(newView: View) {
    setView(newView);
    setTilt(NO_TILT);
    if (atlas) setSlice(middleSlice(atlas, newView));
  }

  const lastSlice = atlas ? sliceCount(atlas, view) - 1 : 0;
  const names = tiltNames(view);

  function stepSlice(delta: number) {
    setSlice((current) => Math.min(lastSlice, Math.max(0, current + delta)));
  }

  async function handleExport() {
    const plane = pipeline.current?.getPlane();
    if (!plane) return;

    const alignment = getAlignment.current();
    const name =
      `P10_${view}_${slice}_tilt_${tilt.vertical}_${tilt.horizontal}` + (alignment ? "_aligned" : "");
    setExportStatus(alignment ? "Exporting at 10 µm onto the tissue…" : "Exporting at 10 µm…");
    try {
      const svg = await requestSliceSvg(plane, name, alignment);
      downloadText(`${name}.svg`, svg, "image/svg+xml");
      setExportStatus(`Exported ${name}.svg`);
    } catch (error) {
      setExportStatus((error as Error).message);
    }
  }

  return (
    <section className="panel">
      <header>
        <select value={view} onChange={(e) => changeView(e.target.value as View)}>
          <option value="coronal">Coronal</option>
          <option value="sagittal">Sagittal</option>
          <option value="axial">Axial</option>
        </select>

        <input
          type="range"
          min={0}
          max={lastSlice}
          value={slice}
          disabled={!atlas}
          onChange={(e) => setSlice(Number(e.target.value))}
        />
        <span className="mono">
          {slice} / {lastSlice}
        </span>

        <button onClick={handleExport} disabled={!atlas}>
          Export SVG
        </button>
      </header>

      <header>
        <TiltSlider
          label={`${names.vertical} tilt`}
          value={tilt.vertical}
          onChange={(vertical) => setTilt({ ...tilt, vertical })}
        />
        <TiltSlider
          label={`${names.horizontal} tilt`}
          value={tilt.horizontal}
          onChange={(horizontal) => setTilt({ ...tilt, horizontal })}
        />
      </header>

      <div className="viewport">
        <div
          className="viewer"
          ref={viewerContainer}
          onWheel={(e) => {
            // Shift + scroll changes slice (plain scroll zooms).
            if (e.shiftKey) stepSlice(Math.sign(e.deltaY || e.deltaX));
          }}
        />
        <div className="preview3d" ref={previewContainer} title="Drag to rotate, scroll to zoom" />
      </div>

      {exportStatus && <div className="report mono">{exportStatus}</div>}

      <footer className="mono">
        {atlas ? `P10 · 20 µm · ${hoveredId ? `region ${hoveredId}` : "–"}` : "Loading atlas…"}
      </footer>
    </section>
  );
}

/** A ±15° slider. Double-click resets it to 0. */
function TiltSlider(props: { label: string; value: number; onChange: (degrees: number) => void }) {
  return (
    <label className="tilt" title="Double-click to reset" onDoubleClick={() => props.onChange(0)}>
      {props.label}
      <input
        type="range"
        min={-MAX_TILT_DEGREES}
        max={MAX_TILT_DEGREES}
        step={0.5}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <span className="mono">{props.value.toFixed(1)}°</span>
    </label>
  );
}
