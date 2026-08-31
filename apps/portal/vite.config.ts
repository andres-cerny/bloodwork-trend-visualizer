import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // Same reasoning as the other two apps: one .env at the repo root.
  envDir: repoRoot,
  publicDir: "public",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  optimizeDeps: { exclude: ["@bw/ui-kit"] },
  server: {
    fs: { allow: [repoRoot] },
    // The portal API worker runs on 8789 (`npm run dev:portal-api`), so the
    // dev server is the whole app, cookies included.
    proxy: {
      "/api": { target: "http://127.0.0.1:8789", changeOrigin: false },
    },
  },
});
