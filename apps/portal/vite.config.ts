import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // .env lives at the repo root, same reasoning as the other two apps: two
  // (now three) chances to silently lose VITE_TURNSTILE_SITE_KEY, one file.
  envDir: repoRoot,
  publicDir: "public",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  optimizeDeps: { exclude: ["@bw/ui-kit", "@bw/api-client"] },
  server: {
    fs: { allow: [repoRoot] },
    // The dev server is the whole app; everything it can ask for is the
    // agent's. Same port as the other shells' proxy target.
    proxy: { "/api": { target: "http://127.0.0.1:8788", changeOrigin: false } },
  },
});
