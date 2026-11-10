import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000";
const to = (rewrite: (p: string) => string) => ({ target: apiTarget, xfwd: true, rewrite });
// The API serves everything under /api on the web origin; xfwd passes the client IP for rate limits.
// Public pages and the GS1 Digital Link resolver are served by the API too (server-rendered, no JS).
// In production a reverse proxy applies the same mapping.
const proxy = {
  "/api": { target: apiTarget, xfwd: true },
  "/p/": to((p) => p.replace(/^\/p\//, "/api/v1/public/p/")),
  "/01/": to((p) => p.replace(/^\/01\//, "/api/v1/r/01/")),
  "/o/": to((p) => p.replace(/^\/o\//, "/api/v1/public/o/")),
  "^/directory(\\?.*)?$": to((p) => p.replace(/^\/directory/, "/api/v1/public/directory-page")),
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 4173, proxy },
});
