/**
 * „přidáno automaticky": the mark after the name of a parameter the app added
 * on its own from the NČLP code table (`VITE_AUTO_ENTRIES`).
 *
 * Quiet — muted ink, a dashed edge, no signal colour (a colour that means
 * something is reserved for meaning it) — but a real button: it opens the
 * sheet that says in words what happened and offers the way back
 * (NameSheet.tsx). It stops the click there, because two of its places sit
 * inside something clickable: a Souhrn row's name, Ověření's selectable row.
 */
export default function AutoMark({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="auto-mark"
      aria-label={`${name}: přidáno automaticky — co to znamená`}
      title="Přidáno automaticky — co to znamená"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      přidáno automaticky
    </button>
  );
}
