import { useCallback, useRef, useState } from "react";
import AtlasPanel from "./components/AtlasPanel";
import ImagePanel from "./components/ImagePanel";
import type { Alignment } from "./exportApi";
import type { SliceLabels } from "./slicePipeline";
import "./App.css";

export default function App() {
  // The atlas slice currently shown on the right, overlaid on the tissue on the left.
  const [atlasSlice, setAtlasSlice] = useState<SliceLabels | null>(null);

  // The tissue panel fills this in; the atlas panel reads it when exporting.
  // (A ref, not state: the alignment changes on every drag and nothing needs to re-render.)
  const getAlignment = useRef<() => Alignment | null>(() => null);
  const provideAlignment = useCallback((getter: () => Alignment | null) => {
    getAlignment.current = getter;
  }, []);

  return (
    <main className="app">
      <ImagePanel atlasSlice={atlasSlice} provideAlignment={provideAlignment} />
      <AtlasPanel onSliceChange={setAtlasSlice} getAlignment={getAlignment} />
    </main>
  );
}
