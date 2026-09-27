/**
 * The last line under the whole app. Without it a render exception unmounted
 * everything and left a white page — no sentence, no way on, and the upload
 * queue gone with it. Chrome's page translation is a known way to cause one
 * (it rewrites the text nodes React owns), and this page is Czech, so every
 * visitor with another browser language is offered exactly that.
 */
import { Component, type ReactNode } from "react";
import { Door } from "./Door";

interface State {
  failed: boolean;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("render failed", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Door>
        <p className="notice" role="alert">
          Něco se pokazilo a stránku se nepodařilo zobrazit. Vaše uložená data jsou v pořádku.
        </p>
        <p className="sub">Pokud máte zapnutý překlad stránky, vypněte ho — s ním se stránka může rozbít.</p>
        <button className="btn primary" onClick={() => location.reload()}>
          Obnovit stránku
        </button>
      </Door>
    );
  }
}
