import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  /**
   * Load .env from the repo root, not from `root`.
   *
   * envDir defaults to `root`, which is "web" here — so a .env at the repo
   * root was silently ignored and VITE_TURNSTILE_SITE_KEY never reached the
   * bundle. The build still succeeded; the upload panel just quietly rendered
   * "not enabled in this demo", which looks like a deliberate configuration
   * rather than a missing file. docs/deploy.md tells you to put it at the
   * repo root, so that is where it is read from.
   */
  envDir: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: "public",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  test: { include: ["tests/**/*.test.ts", "../worker/tests/**/*.test.ts"], environment: "node" },
});
