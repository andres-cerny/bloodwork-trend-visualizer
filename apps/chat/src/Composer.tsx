/**
 * The composer, pinned.
 *
 * On a phone this is the whole ergonomics of the app: the input sits above the
 * keyboard and the transcript scrolls under it, rather than the composer being
 * pushed off the bottom of a growing page.
 */
import { useState } from "react";

export default function Composer({
  busy,
  onSend,
}: {
  busy: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");

  return (
    <form
      className="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        onSend(text);
        setText("");
      }}
    >
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Napište dotaz…"
        aria-label="Dotaz"
        disabled={busy}
        autoComplete="off"
      />
      <button className="btn accent" type="submit" disabled={busy || !text.trim()}>
        Odeslat
      </button>
    </form>
  );
}
