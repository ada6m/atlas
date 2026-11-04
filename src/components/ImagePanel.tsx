import { useEffect, useRef, useState } from "react";
import { inDesktopApp } from "../backend";
import { type Preview, loadPreview, pickFile } from "../microscopyApi";
import type { Alignment } from "../exportApi";
import type { SliceLabels } from "../slicePipeline";
import type { OverlayStyle } from "../overlayImage";
import AtlasOverlay, { type AtlasOverlayHandle } from "./AtlasOverlay";

/**
 * Left panel: the tissue section (a downscaled preview made by the backend),
 * with the current atlas slice overlaid on top for rough alignment.
 */
// Resolution of the tissue preview (µm per pixel). The export rebuilds the same preview.
const PREVIEW_UM_PER_PX = 5;

interface Props {
  atlasSlice: SliceLabels | null;
  /** We hand over a getter so the atlas panel can export the atlas exactly where it sits on the tissue. */
  provideAlignment: (getAlignment: () => Alignment | null) => void;
}

export default function ImagePanel({ atlasSlice, provideAlignment }: Props) {
  const [path, setPath] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewPath, setPreviewPath] = useState(""); // the file the shown preview came from
  const [status, setStatus] = useState("No image loaded");
  const [busy, setBusy] = useState(false);

  const [showOverlay, setShowOverlay] = useState(true);
  const [overlayStyle, setOverlayStyle] = useState<OverlayStyle>("filled");
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const overlay = useRef<AtlasOverlayHandle>(null);

  const viewport = useRef<HTMLDivElement>(null);
  const panZoom = usePanZoom();

  // Tell the export where the atlas sits on this tissue image (null = no tissue loaded).
  useEffect(() => {
    provideAlignment(() => {
      if (!preview || !overlay.current) return null;
      return {
        omePath: previewPath,
        umPerPx: PREVIEW_UM_PER_PX,
        planeToPreview: overlay.current.planeToPreviewMatrix(),
      };
    });
  }, [provideAlignment, preview, previewPath]);

  // Free the previous preview image when a new one replaces it.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.imageUrl);
    };
  }, [preview]);

  async function open(filePath: string) {
    if (!filePath.trim()) return;
    setBusy(true);
    setStatus("Making preview…");
    try {
      const result = await loadPreview(filePath, PREVIEW_UM_PER_PX);
      setPreview(result);
      setPreviewPath(filePath);
      setStatus(describe(result));
      panZoom.fit(viewport.current!, result.info.width, result.info.height);
    } catch (error) {
      setStatus(`Error: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function browse() {
    const chosen = await pickFile();
    if (!chosen) return; // dialog cancelled
    setPath(chosen);
    open(chosen);
  }

  return (
    <section className="panel">
      <header>
        {inDesktopApp && (
          <button onClick={browse} disabled={busy}>
            Browse…
          </button>
        )}
        <input
          className="path"
          type="text"
          placeholder={inDesktopApp ? "or paste a path to an .ome.tif" : "path to an .ome.tif"}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && open(path)}
        />
        <button onClick={() => open(path)} disabled={busy || !path.trim()}>
          Load
        </button>
      </header>

      {preview && (
        <header>
          <label>
            <input type="checkbox" checked={showOverlay} onChange={(e) => setShowOverlay(e.target.checked)} />
            Atlas overlay
          </label>
          <label>
            <input
              type="checkbox"
              checked={overlayStyle === "outlines"}
              onChange={(e) => setOverlayStyle(e.target.checked ? "outlines" : "filled")}
            />
            Outlines only
          </label>
          <label className="grow">
            Opacity
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={overlayOpacity}
              onChange={(e) => setOverlayOpacity(Number(e.target.value))}
            />
          </label>
          <button onClick={() => overlay.current?.flip()}>Flip</button>
          <button onClick={() => overlay.current?.reset()}>Reset</button>
        </header>
      )}

      <div className="viewport" ref={viewport} {...panZoom.handlers}>
        {preview && (
          <div
            className="stage"
            style={{ width: preview.info.width, height: preview.info.height, transform: panZoom.transform }}
          >
            <img src={preview.imageUrl} alt={preview.info.fileName} draggable={false} />

            {atlasSlice && (
              <AtlasOverlay
                ref={overlay}
                visible={showOverlay}
                slice={atlasSlice}
                style={overlayStyle}
                opacity={overlayOpacity}
                previewWidth={preview.info.width}
                previewHeight={preview.info.height}
                previewUmPerPx={preview.info.umPerPx}
                stageScale={panZoom.zoom}
              />
            )}
          </div>
        )}
      </div>

      <footer className="mono">{status}</footer>
    </section>
  );
}

/** e.g. "section.ome.tif · 12000×9000 · DAPI, NeuN · preview 5.0 µm/px" */
function describe({ info }: Preview): string {
  const channels = info.channels.map((c) => c.name || "unnamed").join(", ");
  const scale = info.umPerPx ? `preview ${info.umPerPx.toFixed(1)} µm/px` : "pixel size unknown";
  return `${info.fileName} · ${info.fullWidth}×${info.fullHeight} · ${channels} · ${scale}`;
}

/**
 * Drag the background to pan, scroll to zoom. Drags that start on the atlas
 * overlay or its handles are left to the overlay.
 */
function usePanZoom() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const startsOnOverlay = (target: EventTarget) =>
    (target as Element).closest(".atlas-overlay, .moveable-control-box") !== null;

  const handlers = {
    onWheel(e: React.WheelEvent) {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoom((z) => z * factor);
    },
    onPointerDown(e: React.PointerEvent) {
      if (startsOnOverlay(e.target)) return;
      // Remember where the drag started relative to the current offset.
      dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    },
    onPointerMove(e: React.PointerEvent) {
      if (!dragStart.current) return;
      setOffset({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
    },
    onPointerUp() {
      dragStart.current = null;
    },
    onPointerLeave() {
      dragStart.current = null;
    },
  };

  return {
    handlers,
    zoom,
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
    /** Centre the image and zoom so it fits the viewport. */
    fit(viewportElement: HTMLElement, imageWidth: number, imageHeight: number) {
      const { width, height } = viewportElement.getBoundingClientRect();
      setOffset({ x: 0, y: 0 });
      setZoom(Math.min(width / imageWidth, height / imageHeight) * 0.95);
    },
  };
}
