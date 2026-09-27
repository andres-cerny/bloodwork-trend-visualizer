import { createReadStream, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The OCR files, served from the portal itself (docs/plans/photo-capture.md,
 * D1: "self-hosted from the app's own assets, not a third-party CDN").
 *
 * Copied from node_modules into dist/ocr/ at build time and served from there
 * in dev, rather than committed: ~14 MB of third-party binaries do not belong
 * in git, and the version is whatever package-lock pins. Only the LSTM cores
 * — the engine `ocr.ts` asks for — in the three builds tesseract.js picks
 * between by the browser's SIMD support; a phone downloads one of them.
 */
function ocrAssets(): Plugin {
  const req = createRequire(import.meta.url);
  const pkg = (name: string) => dirname(req.resolve(`${name}/package.json`));
  const files: Record<string, string> = {
    "ocr/worker.min.js": join(pkg("tesseract.js"), "dist/worker.min.js"),
    "ocr/lang/ces.traineddata.gz": join(pkg("@tesseract.js-data/ces"), "4.0.0_best_int/ces.traineddata.gz"),
  };
  for (const core of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"])
    files[`ocr/core/${core}`] = join(pkg("tesseract.js-core"), core);
  return {
    name: "ocr-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = files[(req.url ?? "").split("?")[0].replace(/^\//, "")];
        if (!path) return next();
        res.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        createReadStream(path).pipe(res);
      });
    },
    generateBundle() {
      for (const [fileName, path] of Object.entries(files)) this.emitFile({ type: "asset", fileName, source: readFileSync(path) });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // Same reasoning as the other two apps: one .env at the repo root.
  envDir: repoRoot,
  publicDir: "public",
  plugins: [react(), ocrAssets()],
  build: { outDir: "dist", emptyOutDir: true },
  optimizeDeps: { exclude: ["@bw/ui-kit"] },
  server: {
    fs: { allow: [repoRoot] },
    // The portal API worker runs on 8789 (`npm run dev:portal-api`), so the
    // dev server is the whole app, cookies included. /ai/ is the public share
    // page the worker serves; without it here a link minted locally opened
    // the SPA instead of the page an assistant would read.
    proxy: {
      "/api": { target: process.env.PORTAL_API ?? "http://127.0.0.1:8789", changeOrigin: false },
      "/ai": { target: process.env.PORTAL_API ?? "http://127.0.0.1:8789", changeOrigin: false },
    },
  },
  // `vite preview` proxies the same way, which is how the layout audit serves
  // the built app in front of a fake API (tests/e2e/lib/portalHarness.ts) —
  // PORTAL_API points it at that server instead of the dev worker.
  preview: {
    proxy: {
      "/api": { target: process.env.PORTAL_API ?? "http://127.0.0.1:8789", changeOrigin: false },
      "/ai": { target: process.env.PORTAL_API ?? "http://127.0.0.1:8789", changeOrigin: false },
    },
  },
});
