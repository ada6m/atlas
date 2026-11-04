import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Send /api requests to the Python backend (backend/main.py).
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
