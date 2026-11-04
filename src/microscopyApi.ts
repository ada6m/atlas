/**
 * Microscopy images (.ome.tif) are read by the Python backend, never in the
 * browser: files can be several GB. The page only gets a small preview PNG.
 */

import { open } from "@tauri-apps/plugin-dialog";
import { backendFetch } from "./backend";

export interface PreviewInfo {
  fileName: string;
  fullWidth: number;
  fullHeight: number;
  fullUmPerPx: number | null; // null if the file doesn't record its pixel size
  width: number;
  height: number;
  umPerPx: number | null; // µm per pixel of the preview
  channels: { name: string; color: [number, number, number] }[];
}

export interface Preview {
  imageUrl: string; // object URL of the PNG; revoke when replaced
  info: PreviewInfo;
}

/** The operating system's file dialog (desktop app only). Returns the real path, or null if cancelled. */
export async function pickFile(): Promise<string | null> {
  return open({
    title: "Choose a microscopy image",
    multiple: false,
    directory: false,
    filters: [{ name: "OME-TIFF", extensions: ["ome.tif", "ome.tiff", "tif", "tiff"] }],
  });
}

export async function loadPreview(path: string, umPerPx = 5): Promise<Preview> {
  const response = await backendFetch("/api/ome/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, um_per_px: umPerPx }),
  });

  if (!response.ok) {
    const { detail } = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(detail);
  }

  const info: PreviewInfo = JSON.parse(response.headers.get("X-Preview-Info")!);
  const imageUrl = URL.createObjectURL(await response.blob());
  return { imageUrl, info };
}
