/**
 * Talking to the Python backend.
 *
 * In the desktop app, Tauri starts the backend on a free port and tells us the
 * address. In a plain browser (`npm run dev` on its own), requests go to /api
 * and Vite forwards them to a backend started by hand (see vite.config.ts).
 */

import { invoke, isTauri } from "@tauri-apps/api/core";

export const inDesktopApp = isTauri();

const STARTUP_TIMEOUT_MS = 60_000; // Python + numpy + opening the atlas can take a few seconds

let backendAddress: Promise<string> | null = null;

/** fetch() against the backend, waiting for it to finish starting if needed. */
export async function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  backendAddress ??= findBackend();
  return fetch((await backendAddress) + path, init);
}

async function findBackend(): Promise<string> {
  if (!inDesktopApp) return ""; // same origin; Vite proxies /api

  const address = await invoke<string>("backend_url"); // rejects with a message if it couldn't start
  await waitUntilReady(address);
  return address;
}

/** Poll /api/health until the backend answers. */
async function waitUntilReady(address: string) {
  const giveUpAt = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < giveUpAt) {
    try {
      const response = await fetch(`${address}/api/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("The Python backend didn't start in time. Check the terminal running `tauri dev`.");
}
