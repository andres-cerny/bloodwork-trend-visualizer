/**
 * Analyte mapping review. Suggestions are precomputed by fuzzy name similarity
 * against the registry — the same evidence the Python surfaces (unit match,
 * plausible value) shown per candidate so the choice is auditable rather than
 * a black box.
 */
import { useMemo } from "react";
import type { LabReport } from "../lib/models";
import { normKey, type Registry } from "../lib/registry";

interface Props {
  reports: LabReport[];
  registry: Registry;
  onMap: (rawName: string, canonicalId: string) => void;
}

interface Candidate {
  canonicalId: string;
  displayName: string;
  score: number;
  unitMatch: boolean | null;
  canonicalUnit: string;
}

/** Character-bigram Dice coefficient — cheap, and stable for Czech names. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let hits = 0;
  for (const [g, n] of ga) hits += Math.min(n, gb.get(g) ?? 0);
  return (2 * hits) / (a.length - 1 + b.length - 1);
}

function suggest(rawName: string, rawUnit: string, registry: Registry, topN = 3): Candidate[] {
  const key = normKey(rawName);
  if (!key) return [];
  const ru = rawUnit.trim().toLowerCase().replace(/\s+/g, "");
  const out: Candidate[] = [];
  for (const a of registry.analytes.values()) {
    const keys = [a.canonicalId, a.displayNameCs, ...a.synonyms].map(normKey).filter(Boolean);
    if (keys.length === 0) continue;
    let nameSim = Math.max(...keys.map((k) => similarity(key, k)));
    // Substring containment is strong evidence the fuzzy score under-rates.
    if (key.length >= 3 && keys.some((k) => k.length >= 3 && (k.includes(key) || key.includes(k)))) {
      nameSim += 0.15;
    }
    const cu = (a.canonicalUnit || "").toLowerCase().replace(/\s+/g, "");
    let unitMatch: boolean | null = null;
    let score = nameSim;
    if (ru && cu) {
      unitMatch = ru === cu || Object.keys(a.unitConversions).some((u) => u.toLowerCase().replace(/\s+/g, "") === ru);
      score += unitMatch ? 0.2 : -0.25;
    }
    if (score >= 0.45) {
      out.push({ canonicalId: a.canonicalId, displayName: a.displayNameCs, score, unitMatch, canonicalUnit: a.canonicalUnit });
    }
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, topN);
}

export default function MappingTab({ reports, registry, onMap }: Props) {
  const unmapped = useMemo(() => {
    const seen = new Map<string, { unit: string; count: number }>();
    for (const r of reports)
      for (const m of r.measurements)
        if (m.canonicalId === null) {
          const e = seen.get(m.rawAnalyteName);
          if (e) e.count += 1;
          else seen.set(m.rawAnalyteName, { unit: m.unitRaw, count: 1 });
        }
    return [...seen.entries()].map(([rawName, v]) => ({ rawName, ...v }));
  }, [reports]);

  if (unmapped.length === 0)
    return (
      <div className="card">
        <h2>Namapování analytů</h2>
        <p className="muted">Všechny analyty jsou namapované — není co řešit.</p>
      </div>
    );

  return (
    <>
      <div className="card">
        <h2>Namapování analytů</h2>
        <p className="sub">
          Tyto názvy zatím neznáme. Návrhy počítáme lokálně z podobnosti názvu a
          shody jednotky — žádné volání modelu. Po přijetí si je aplikace pamatuje
          a analyt se objeví v trendech.
        </p>
      </div>
      {unmapped.map(({ rawName, unit, count }) => {
        const cands = suggest(rawName, unit, registry);
        return (
          <div className="card" key={rawName}>
            <h3>
              {rawName} <span className="muted">({unit || "bez jednotky"}, {count}×)</span>
            </h3>
            {cands.length === 0 ? (
              <p className="muted">Žádný dostatečně podobný analyt v registru.</p>
            ) : (
              <ul className="cand-list">
                {cands.map((c) => (
                  <li key={c.canonicalId} className="cand">
                    <div className="cand-main">
                      <strong>{c.displayName}</strong>
                      <div>
                        {/* Boosts can push the raw score past 1; the bar is a
                            confidence cue, not a probability, so clamp it. */}
                        <span className="chip">{Math.min(100, Math.round(c.score * 100))} % shoda</span>
                        {c.canonicalUnit && <span className="chip">{c.canonicalUnit}</span>}
                        {c.unitMatch === true && <span className="chip">✔ jednotka</span>}
                        {c.unitMatch === false && <span className="chip alert">✘ jednotka</span>}
                      </div>
                    </div>
                    <button className="btn primary" onClick={() => onMap(rawName, c.canonicalId)}>
                      Přijmout
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </>
  );
}
