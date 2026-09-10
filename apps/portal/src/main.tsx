import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@bw/ui-kit/styles.css";
import "./legacy.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
