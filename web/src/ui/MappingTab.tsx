/**
 * Analyte mapping review.
 *
 * The question being answered is "is the thing I already have under this
 * heading the same measurement as the thing I am looking at" — so both sides
 * are shown: every place the unknown name was seen with what it read, and
 * what data already sits under each candidate. Suggestions are computed
 * locally from name similarity, unit compatibility and value plausibility;
 * no model is involved, and each candidate shows the evidence behind its
 * ranking rather than only a score.
 */
import { useMemo, useState } from "react";
import type { LabReport } from "../lib/models";
import {
  findUnmapped,
  observedStats,
  suggestMappings,
  type Candidate,
  type UnmappedAnalyte,
} from "../lib/mapping";
import { czNum } from "../lib/summary";
import { count, czDate } from "../lib/czech";
import type { Registry } from "../lib/registry";

interface Props {
  reports: LabReport[];
  registry: Registry;
  onMap: (rawName: string, canonicalId: string) => void;
  /** Jump to the verification tab focused on one occurrence. */
  onShowSource: (reportId: string, rawName: string) => void;
}

const MATERIAL_CS: Record<string, string> = {
  s: "sérum", b: "plná krev", p: "plazma", u: "moč", pk: "plazma", fw: "krev",
};
const materialCs = (m: string) => MATERIAL_CS[m] ?? m.toUpperCase();

function Evidence({ c, incomingUnit }: { c: Candidate; incomingUnit: string }) {
  const o = c.observed;
  return (
    <ul className="evidence">
      <li>
        <span className="ev-label">Jednotka</span>
        <span className={`ev-val ${c.unitMatch === false ? "bad" : ""}`}>
          {c.unitMatch === null
            ? "nelze porovnat"
            : c.unitMatch
              ? `✔ obojí ${c.canonicalUnit || o?.unit}`
              : `✘ ${incomingUnit || "?"} vs ${c.canonicalUnit || o?.unit || "?"}`}
        </span>
      </li>
      {c.materialMatch !== null && (
        <li>
          <span className="ev-label">Materiál</span>
          <span className={`ev-val ${c.materialMatch === false ? "bad" : ""}`}>
            {c.materialMatch
              ? `✔ obojí ${o?.materials.map(materialCs).join(", ")}`
              : `✘ jiný materiál než ${o?.materials.map(materialCs).join(", ")}`}
          </span>
        </li>
      )}
      <li>
        <span className="ev-label">Hodnoty</span>
        <span className={`ev-val ${c.valueOk === false ? "bad" : ""}`}>
          {c.valueOk === null
            ? "není s čím porovnat"
            : c.valueOk
              ? "✔ řádově odpovídají"
              : c.incomingRange
                ? `✘ ${czNum(c.incomingRange[0])}–${czNum(c.incomingRange[1])} vs ${czNum(o?.min)}–${czNum(o?.max)}`
                : "✘ neodpovídají"}
        </span>
      </li>
    </ul>
  );
}

/** A candidate contradicted by unit, material or magnitude is not a near miss. */
function isImplausible(c: Candidate): boolean {
  return c.unitMatch === false || c.materialMatch === false || c.valueOk === false;
}

function ExistingData({ c }: { c: Candidate }) {
  const o = c.observed;
  if (!o || o.count === 0) {
    return (
      <p className="muted" style={{ margin: "6px 0 0" }}>
        Zatím žádná naměřená data — analyt je v registru, ale v těchto reportech
        se ještě neobjevil.
      </p>
    );
  }
  return (
    <div className="existing">
      <p className="muted" style={{ margin: "0 0 4px" }}>
        Už máme <strong>{o.count}</strong> měření
        {o.firstDate && o.lastDate && (
          <>
            {" "}
            ({o.firstDate === o.lastDate ? o.firstDate : `${o.firstDate} → ${o.lastDate}`})
          </>
        )}
        {o.unit && <> v jednotce <strong>{o.unit}</strong></>}
        {o.min !== null && o.max !== null && (
          <>
            , rozsah <strong>{czNum(o.min)}–{czNum(o.max)}</strong>
          </>
        )}
        .
      </p>
    </div>
  );
}

export default function MappingTab({ reports, registry, onMap, onShowSource }: Props) {
  const unmapped = useMemo(() => findUnmapped(reports), [reports]);
  const stats = useMemo(() => observedStats(reports), [reports]);
  const [open, setOpen] = useState<string | null>(null);

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
          Tyto názvy zatím neznáme, takže se neobjeví v trendech. U každého vidíte,
          kde přesně se v dokumentech vyskytl a co tam bylo naměřeno, a u každého
          návrhu, jaká data už pod ním máme — abyste mohli posoudit, jestli jde
          opravdu o totéž vyšetření.
        </p>
      </div>

      {unmapped.map((a: UnmappedAnalyte) => {
        const cands = suggestMappings(a, registry, stats);
        const isOpen = open === a.rawName;
        return (
          <div className="card" key={a.rawName}>
            <h3 style={{ marginBottom: 4 }}>{a.rawName}</h3>
            <p className="muted" style={{ margin: "0 0 10px" }}>
              {a.unitRaw && a.unitRaw.trim() !== "-" ? a.unitRaw : "bez jednotky"} ·{" "}
              {count(a.occurrences.length, "výskyt", "výskyty", "výskytů")} v dokumentech
            </p>

            {/* Provenance: where it came from and what it read there. */}
            <div className="scroll-x">
              <table className="occ">
                <thead>
                  <tr>
                    <th>Dokument</th>
                    <th style={{ textAlign: "right" }}>Naměřeno</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {a.occurrences.map((o, i) => (
                    <tr key={i}>
                      <td>{czDate(o.date)}<span className="muted"> · s. {o.page}</span></td>
                      <td className="num">
                        {o.valueRaw} <span className="muted">{a.unitRaw}</span>
                      </td>
                      <td>
                        <button
                          className="btn linkish"
                          onClick={() => onShowSource(o.reportId, a.rawName)}
                        >
                          Zobrazit v dokumentu
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4 className="cand-head">Namapovat na</h4>
            {cands.length === 0 ? (
              <p className="muted">Žádný dostatečně podobný analyt v registru.</p>
            ) : (
              <ul className="cand-list">
                {cands.map((c, i) => {
                  const bad = isImplausible(c);
                  return (
                    <li key={c.canonicalId} className={`cand-card${bad ? " implausible" : ""}`}>
                      <div className="cand-top">
                        <div>
                          <strong>{c.displayName}</strong>
                          {i === 0 && !bad && <span className="chip best">nejlepší shoda</span>}
                          {bad && <span className="chip alert">nedoporučujeme</span>}
                        </div>
                        {/* A contradicted candidate keeps a quiet button. An
                            identical black button beside a red warning invites
                            the click it is warning against. */}
                        <button
                          className={bad ? "btn" : "btn primary"}
                          onClick={() => onMap(a.rawName, c.canonicalId)}
                        >
                          Namapovat{bad ? " přesto" : ""}
                        </button>
                      </div>
                      <ExistingData c={c} />
                      <Evidence c={c} incomingUnit={a.unitRaw} />
                    </li>
                  );
                })}
              </ul>
            )}

            <button className="btn linkish" onClick={() => setOpen(isOpen ? null : a.rawName)}>
              {isOpen ? "Skrýt" : "Nechat nenamapované — proč?"}
            </button>
            {isOpen && (
              <p className="muted" style={{ marginBottom: 0 }}>
                Nenamapovaný analyt se nikam neztratí — zůstane v Ověření u svého
                dokumentu, jen se nezobrazí v trendech, protože ho nelze spolehlivě
                porovnat mezi odběry.
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}
