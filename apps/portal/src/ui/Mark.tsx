/**
 * What follows a parameter's name wherever a screen names one as the subject
 * of a row or a card — today only the „přidáno automaticky" mark
 * (AutoMark.tsx, VITE_AUTO_ENTRIES). Through a context, so Souhrn's three
 * tables, Trendy's cards and Ověření's rows need no prop threaded through
 * every sub-component; with nothing provided it renders nothing, which is the
 * app with the switch off.
 */
import { type ReactNode, createContext, useContext } from "react";

export const MarkContext = createContext<(canonicalId: string) => ReactNode>(() => null);

export default function Mark({ id }: { id: string | null | undefined }) {
  const mark = useContext(MarkContext);
  return id ? <>{mark(id)}</> : null;
}
