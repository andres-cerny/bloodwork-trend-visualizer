import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./ui/ErrorBoundary";
import "@bw/ui-kit/styles.css";
import "./legacy.css";
import "./styles.css";

// A tab opened before a deploy asks for code chunks (the PDF reader, OCR)
// under hashes the new deploy no longer serves, and the import fails with an
// English error on the first upload. Reload to pick up the new build — at
// most once a minute, so a chunk missing for another reason cannot loop.
window.addEventListener("vite:preloadError", (event) => {
  let recent = true;
  try {
    const last = Number(sessionStorage.getItem("mk:reloaded-for-chunk") ?? 0);
    recent = Date.now() - last < 60_000;
    if (!recent) sessionStorage.setItem("mk:reloaded-for-chunk", String(Date.now()));
  } catch {
    recent = true;
  }
  if (recent) return;
  event.preventDefault();
  location.reload();
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
