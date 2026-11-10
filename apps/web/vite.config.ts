import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API in development: /api/* → API server, so cookies and CSRF work without CORS.
    proxy: { "/api": { target: apiTarget, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  preview: { port: 4173, proxy: { "/api": { target: apiTarget, rewrite: (p) => p.replace(/^\/api/, "") } } },
});
