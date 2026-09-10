/**
 * Rows out of a tool call that is still being written.
 *
 * With eager tool-input streaming the model's JSON arrives as fragments,
 * split anywhere — mid-number, mid-string. The page is not readable until
 * the last fragment, but each *row* is: the moment a `{…}` inside the
 * `measurements` array closes, that row is complete and can be shown. This
 * scanner finds those moments without parsing the whole document: a depth
 * counter, a string-state flag so braces inside names do not count, and the
 * one key it cares about.
 *
 * Rows emitted here are provisional — for a screen, not for a trend. The
 * final message is still parsed whole and is the only thing stored, so a
 * fragment the scanner misjudged costs a flicker, never a value.
 */
export interface RowScanner {
  /** Feed the next fragment of the tool input, in order. */
  feed(fragment: string): void;
  /** Rows emitted so far. */
  readonly count: number;
}

export function createRowScanner(onRow: (row: Record<string, unknown>) => void): RowScanner {
  let buf = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  let token = "";
  /** The last string closed at depth 1 — the key whose value comes next. */
  let lastKey: string | null = null;
  /** Depth of the measurements array's contents, or -1 outside it. */
  let arrayDepth = -1;
  let objStart = -1;
  let count = 0;

  return {
    get count() {
      return count;
    },
    feed(fragment: string) {
      const from = buf.length;
      buf += fragment;
      for (let i = from; i < buf.length; i++) {
        const c = buf[i];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (c === "\\") {
            escaped = true;
          } else if (c === '"') {
            inString = false;
            if (depth === 1) {
              try {
                lastKey = JSON.parse(`"${token}"`);
              } catch {
                lastKey = null;
              }
            }
          }
          token += c;
          continue;
        }
        if (c === '"') {
          inString = true;
          token = "";
          continue;
        }
        if (c === "{" || c === "[") {
          if (c === "[" && depth === 1 && lastKey === "measurements") arrayDepth = depth + 1;
          depth += 1;
          if (c === "{" && depth === arrayDepth + 1) objStart = i;
          continue;
        }
        if (c === "}" || c === "]") {
          if (c === "}" && depth === arrayDepth + 1 && objStart >= 0) {
            const text = buf.slice(objStart, i + 1);
            objStart = -1;
            try {
              onRow(JSON.parse(text));
              count += 1;
            } catch {
              // A fragment the scanner misjudged. The final message decides.
            }
          }
          if (c === "]" && depth === arrayDepth) arrayDepth = -1;
          depth -= 1;
        }
      }
      // Nothing before an open object is needed again; keep memory flat on a
      // long page. Indexes restart from zero with the next fragment.
      if (objStart < 0 && buf.length > 32768) buf = "";
      else if (objStart > 0 && objStart > 32768) {
        buf = buf.slice(objStart);
        objStart = 0;
      }
    },
  };
}
