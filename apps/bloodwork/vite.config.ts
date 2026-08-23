import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  /**
   * Load .env from the repo root, not from `root`.
   *
   * envDir defaults to `root`, and when that was "web" a .env at the repo root
   * was silently ignored: VITE_TURNSTILE_SITE_KEY never reached the bundle, the
   * build still succeeded, and the upload panel rendered "not enabled in this
   * demo" — which reads as a deliberate setting rather than a broken one. With
   * two apps there are two chances to make that mistake, so both read the same
   * file, and check-bundle.mjs fails the deploy if the key does not arrive.
   */
  envDir: repoRoot,
  publicDir: "public",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  /**
   * Keep linked workspace packages in Vite's plugin pipeline rather than
   * esbuild's pre-bundler. Load-bearing: lab-core/pdf imports the pdf.js worker
   * with `?url`, which only resolves to an emitted asset on the plugin path.
   */
  optimizeDeps: { exclude: ["@bw/lab-core", "@bw/ui-kit", "@bw/api-client"] },
  server: {
    fs: { allow: [repoRoot] },
    // `npm run dev` used to 404 the AI routes. Proxying to the capability
    // workers means the dev server is the whole app.
    proxy: {
      "/api/chat": { target: "http://127.0.0.1:8788", changeOrigin: false },
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: false },
    },
  },
});
