/** Status marker. Colour is never the only channel — arrow glyph + Czech label. */
import { type Flag as FlagType } from "@bw/lab-core";

export default function Flag({ flag }: { flag: FlagType }) {
  if (flag === "high") return <span className="flag out">↑ nad rozmezím</span>;
  if (flag === "low") return <span className="flag out">↓ pod rozmezím</span>;
  if (flag === "normal") return <span className="flag norm">v rozmezí</span>;
  return <span className="flag unk">—</span>;
}
