/**
 * Analyte mapping review.
 *
 * The question is never "are these two names similar". It is "is the thing I
 * already have under this heading the same measurement as the thing I am
 * looking at" — and getting it wrong merges one analyte's history into
 * another's, where it then looks like it always belonged.
 *
 * So the screen is built around the decision rather than around the data:
 *
 *   - the recommendation comes first, with its evidence, and the reader can
 *     accept it without scrolling;
 *   - the alternatives, the provenance and the escape hatch are one click
 *     away each, because they are what you reach for when the recommendation
 *     looks wrong, not before;
 *   - when nothing survives the evidence the screen says so and offers the
 *     registry instead of promoting the least-bad guess;
 *   - every acceptance can be undone, so the destructive step is reversible.
 *
 * The evidence itself is computed in lib/mapping.ts — locally, from name
 * similarity, unit, reference interval, material and value plausibility. No
 * model is involved, and each signal is shown rather than folded into a score.
 */
import { useMemo, useState } from "react";
import {
  type LabReport,
  findUnmapped,
  materialCs,
  materialPrefix,
  observedStats,
  signalsOf,
  suggestMappings,
  verdictOf,
  type Candidate,
  type Signal,
  type UnmappedAnalyte,
  czNum,
  count,
  czDate,
  prettyUnit,
  type Registry,
  type CustomAnalyte,
  canonicalizeUnit,
  customAnalyteId,
  defaultParameterName,
  findExistingParameter,
  normKey,
} from "@bw/lab-core";
import AnalytePicker, { type PickerOption } from "./AnalytePicker";

interface Props {
  reports: LabReport[];
  registry: Registry;
  /** Parameters the reader founded here, newest last. */
  customAnalytes: CustomAnalyte[];
  onMap: (rawName: string, canonicalId: string) => void;
  onUndoMap: (rawName: string, canonicalId: string) => void;
  onCreateParameter: (rawName: string, c: CustomAnalyte) => void;
  onDeleteParameter: (canonicalId: string) => void;
  /** Jump to the verification tab focused on one occurrence. */
  onShowSource: (reportId: string, rawName: string) => void;
}

const GLYPH: Record<Signal["state"], string> = { ok: "✔", bad: "✘", unknown: "–" };

function SignalList({ signals }: { signals: Signal[] }) {
  return (
    <ul className="signals">
      {signals.map((s) => (
        <li key={s.key} className={`sig sig-${s.state}`}>
          <span className="sig-mark" aria-hidden="true">
            {GLYPH[s.state]}
          </span>
          <span className="sig-label">{s.label}</span>
          <span className="sig-detail">{s.detail}</span>
        </li>
      ))}
    </ul>
  );
}

/** One-line summary of the data already filed under a candidate. */
function existingLine(c: Candidate): string {
  const o = c.observed;
  if (!o || o.count === 0) return "Pod tímto názvem zatím žádná data nemáme.";
  const span =
    o.firstDate && o.lastDate
      ? o.firstDate === o.lastDate
        ? ` z ${czDate(o.firstDate)}`
        : ` z období ${czDate(o.firstDate)} – ${czDate(o.lastDate)}`
      : "";
  const range =
    o.min !== null && o.max !== null ? `, rozsah ${czNum(o.min)}–${czNum(o.max)}` : "";
  const unit = o.unit ? ` ${prettyUnit(o.unit)}` : "";
  return `Už máme ${count(o.count, "měření", "měření", "měření")}${span}${range}${unit}.`;
}

function CandidateBlock({
  c,
  incoming,
  featured,
  onAssign,
}: {
  c: Candidate;
  incoming: UnmappedAnalyte;
  /** The promoted recommendation, as opposed to one of the alternatives. */
  featured: boolean;
  onAssign: () => void;
}) {
  const verdict = verdictOf(c);
  const bad = verdict === "contradicted";
  const signals = useMemo(() => signalsOf(c, incoming), [c, incoming]);

  return (
    <div className={`cand-card${featured ? " featured" : ""}${bad ? " implausible" : ""}`}>
      <div className="cand-top">
        <div className="cand-id">
          <strong>{c.displayName}</strong>
          {verdict === "recommended" && featured && <span className="chip best">doporučeno</span>}
          {verdict === "possible" && <span className="chip">bez potvrzení</span>}
          {bad && <span className="chip alert">nedoporučujeme</span>}
        </div>
        {/* A contradicted candidate keeps a quiet button. An identical accent
            button beside a red warning invites the click it is warning
            against. */}
        <button className={bad ? "btn" : "btn primary"} onClick={onAssign}>
          Přiřadit{bad ? " přesto" : ""}
        </button>
      </div>
      <p className="cand-effect">
        {existingLine(c)}{" "}
        <span className="muted">
          Přiřazením přibude {count(incoming.occurrences.length, "měření", "měření", "měření")}.
        </span>
      </p>
      <SignalList signals={signals} />
    </div>
  );
}

function Occurrences({
  a,
  onShowSource,
}: {
  a: UnmappedAnalyte;
  onShowSource: Props["onShowSource"];
}) {
  return (
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
              <td>
                {czDate(o.date)}
                <span className="muted"> · s. {o.page}</span>
              </td>
              <td className="num">
                {o.valueRaw} <span className="muted">{prettyUnit(a.unitRaw)}</span>
              </td>
              <td>
                <button className="btn linkish" onClick={() => onShowSource(o.reportId, a.rawName)}>
                  Zobrazit v dokumentu
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Founding a parameter on a printed name the app does not know.
 *
 * The screen used to offer two endings for such a name: merge it into an
 * existing parameter, or leave it out of the trends. For a test the app has
 * simply never heard of, both are wrong — one files it under the wrong
 * heading, the other hides the reader's own result on the screen built to
 * show it.
 *
 * Two decisions here are the reader's. The name, which arrives as the printed
 * one with its material prefix taken off and can be corrected, and the unit.
 * The reference interval is not one of them: it is the one the lab printed on
 * their own report, shown so they can see what the parameter is founded on,
 * and not typed — no other screen in this app lets anyone author a clinical
 * threshold, and this is not the place to start.
 *
 * The name is checked against every parameter the app knows on each
 * keystroke. Founding a second "Feritin" would leave one test with two trend
 * lines holding half the history each and nothing on screen to say why: the
 * failure the rest of this screen exists to prevent, reached from the other
 * side.
 */
function NewParameterForm({
  a,
  registry,
  onCreate,
  onMapInstead,
  onCancel,
}: {
  a: UnmappedAnalyte;
  registry: Registry;
  onCreate: (c: CustomAnalyte) => void;
  onMapInstead: (canonicalId: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(() => defaultParameterName(a.rawName));
  const [unit, setUnit] = useState(() => canonicalizeUnit(a.unitRaw) ?? a.unitRaw);

  const clash = useMemo(() => findExistingParameter(registry.analytes.values(), name), [registry, name]);
  // normKey is what the registry keys names on. A name it reduces to nothing
  // could never be matched again, and cannot make an id either.
  const named = normKey(name) !== "";
  const dates = a.occurrences.map((o) => o.date).filter(Boolean) as string[];
  const from = a.refRangeFrom?.date;

  return (
    <form
      className="new-param"
      onSubmit={(e) => {
        e.preventDefault();
        if (!named || clash) return;
        onCreate({
          canonicalId: customAnalyteId(name, (id) => registry.analytes.has(id)),
          displayNameCs: name.trim(),
          canonicalUnit: canonicalizeUnit(unit) ?? "",
          referenceRange: a.refRange ? [a.refRange.low, a.refRange.high] : null,
        });
      }}
    >
      <p className="section-title">Nový parametr</p>

      <div className="np-fields">
        <label>
          <span>Název parametru</span>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the button that
              opens this form is the one action that leads here. */}
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="np-unit">
          <span>Jednotka</span>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} />
        </label>
      </div>

      <p className="np-range">
        <span className="np-label">Referenční rozmezí</span>{" "}
        {a.refRange ? (
          <>
            <strong>
              {czNum(a.refRange.low)}–{czNum(a.refRange.high)}
              {prettyUnit(unit) && <> {prettyUnit(unit)}</>}
            </strong>
            {from && <span className="muted"> · z dokumentu {czDate(from)}</span>}
          </>
        ) : (
          <span className="muted">laboratoř ho u tohoto parametru neuvedla</span>
        )}
      </p>

      {clash ? (
        <p className="banner warn np-clash">
          <span>
            Takový parametr už známe: <strong>{clash.displayNameCs}</strong>. Druhý parametr pro
            totéž vyšetření by rozdělil historii na dvě poloviny — přiřaďte název k němu.
          </span>
          <button type="button" className="btn small" onClick={() => onMapInstead(clash.canonicalId)}>
            Přiřadit k tomuto parametru
          </button>
        </p>
      ) : named ? (
        <p className="cand-effect">
          Přibude {count(a.occurrences.length, "měření", "měření", "měření")}
          {dates.length > 0 && (
            <>
              {" "}
              z období {czDate(dates[0])} – {czDate(dates[dates.length - 1])}
            </>
          )}
          .{" "}
          <span className="muted">
            Nový parametr se objeví v trendech a příští report ho už pozná sám.
          </span>
        </p>
      ) : (
        <p className="cand-effect muted">Zadejte název parametru.</p>
      )}

      <div className="np-actions">
        <button type="submit" className="btn primary" disabled={!named || clash !== null}>
          Založit
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Zrušit
        </button>
      </div>
    </form>
  );
}

function UnmappedCard({
  a,
  cands,
  registry,
  customAnalytes,
  onMap,
  onCreate,
  onShowSource,
  onDefer,
}: {
  a: UnmappedAnalyte;
  cands: Candidate[];
  registry: Registry;
  customAnalytes: CustomAnalyte[];
  onMap: (rawName: string, canonicalId: string) => void;
  onCreate: (rawName: string, c: CustomAnalyte) => void;
  onShowSource: Props["onShowSource"];
  onDefer: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [picking, setPicking] = useState(false);
  const [founding, setFounding] = useState(false);

  // Promote the leader only if the evidence actually backs it. Leading with a
  // contradicted candidate is how a wrong mapping gets one accepting click.
  const lead = cands.length > 0 && verdictOf(cands[0]) !== "contradicted" ? cands[0] : null;
  const rest = lead ? cands.slice(1) : cands;

  const values = a.occurrences.map((o) => o.value).filter((v): v is number => v !== null);
  const dates = a.occurrences.map((o) => o.date).filter(Boolean) as string[];
  const material = materialPrefix(a.rawName);
  // A qualitative analyte ("negativní") has no numeric range to summarise, and
  // showing nothing where every other card shows values read as missing data
  // rather than as a different kind of test.
  const wordValues =
    values.length === 0 ? [...new Set(a.occurrences.map((o) => o.valueRaw))].slice(0, 3) : [];

  // Every analyte in the registry, so a name the suggester ranked out — or
  // never offered at all — is still reachable. Without this the reader's only
  // options were the top three guesses.
  // Keyed on customAnalytes as well as the registry, which is one mutable
  // instance whose identity never changes: without it a parameter founded a
  // moment ago would be missing from this list until the screen remounted,
  // and the second lab’s spelling of the same test could not be filed under
  // it — the thing founding one is for.
  const options: PickerOption[] = useMemo(
    () =>
      [...registry.analytes.values()]
        .map((d) => ({ id: d.canonicalId, label: d.displayNameCs }))
        .sort((x, y) => x.label.localeCompare(y.label, "cs")),
    [registry, customAnalytes],
  );

  return (
    <div className="card map-card">
      <div className="map-head">
        <div>
          <h3>{a.rawName}</h3>
          <p className="muted map-meta">
            {material && <>{materialCs(material)} · </>}
            {prettyUnit(a.unitRaw) || "bez jednotky"} ·{" "}
            {count(a.occurrences.length, "výskyt", "výskyty", "výskytů")}
            {values.length > 0 && (
              <>
                {" "}
                · {czNum(Math.min(...values))}–{czNum(Math.max(...values))}
              </>
            )}
            {wordValues.length > 0 && <> · {wordValues.join(", ")}</>}
            {dates.length > 0 && (
              <>
                {" "}
                · {czDate(dates[0])} – {czDate(dates[dates.length - 1])}
              </>
            )}
          </p>
        </div>
      </div>

      {lead ? (
        <>
          <p className="section-title">Doporučené přiřazení</p>
          <CandidateBlock
            c={lead}
            incoming={a}
            featured
            onAssign={() => onMap(a.rawName, lead.canonicalId)}
          />
        </>
      ) : (
        <p className="banner no-lead">
          {cands.length === 0
            ? "V registru není žádný dostatečně podobný parametr."
            : "Žádný návrh neobstál — u všech mluví něco proti tomu, že jde o totéž vyšetření."}{" "}
          Vyberte parametr ručně, založte nový, nebo nechte název nepřiřazený.
        </p>
      )}

      <div className="map-actions">
        {rest.length > 0 && (
          <button className="btn" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? "Skrýt další návrhy" : `Další návrhy (${rest.length})`}
          </button>
        )}
        <div className="picker-anchor">
          <button className="btn" onClick={() => setPicking(true)}>
            Vybrat jiný parametr…
          </button>
          {picking && (
            <AnalytePicker
              options={options}
              onPick={(id) => {
                setPicking(false);
                onMap(a.rawName, id);
              }}
              onClose={() => setPicking(false)}
            />
          )}
        </div>
        <button className="btn" onClick={() => setFounding((v) => !v)} aria-expanded={founding}>
          Založit nový parametr
        </button>
        <button className="btn" onClick={onDefer}>
          Nechat nepřiřazené
        </button>
      </div>

      {founding && (
        <NewParameterForm
          a={a}
          registry={registry}
          onCreate={(c) => {
            setFounding(false);
            onCreate(a.rawName, c);
          }}
          onMapInstead={(id) => {
            setFounding(false);
            onMap(a.rawName, id);
          }}
          onCancel={() => setFounding(false)}
        />
      )}

      {showAll && rest.length > 0 && (
        <ul className="cand-list">
          {rest.map((c) => (
            <li key={c.canonicalId}>
              <CandidateBlock
                c={c}
                incoming={a}
                featured={false}
                onAssign={() => onMap(a.rawName, c.canonicalId)}
              />
            </li>
          ))}
        </ul>
      )}

      <details className="occ-details">
        <summary className="section-title">
          Kde se v dokumentech vyskytl ({a.occurrences.length})
        </summary>
        <Occurrences a={a} onShowSource={onShowSource} />
      </details>
    </div>
  );
}

/**
 * The parameters the reader founded, and the way back out of one.
 *
 * Accepting a mapping is undoable for one click, which covers a misclick and
 * is no help whatever three months later. A founded parameter is a heading
 * that keeps appearing in Trendy and in every export, so it gets a list of
 * its own and a delete that states what it does: the printed names go back to
 * the unmapped list, and not one measured value is touched.
 */
function CustomParams({
  customAnalytes,
  registry,
  onDelete,
}: {
  customAnalytes: CustomAnalyte[];
  registry: Registry;
  onDelete: (canonicalId: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div className="card custom-card">
      <details>
        <summary className="section-title">Vlastní parametry ({customAnalytes.length})</summary>
        <p className="muted" style={{ marginTop: 8 }}>
          Parametry, které jste založili z názvů v dokumentech. Smazáním se jejich názvy vrátí
          mezi nepřiřazené — naměřené hodnoty zůstanou, jen se přestanou zobrazovat v trendech.
        </p>
        <ul className="held-list">
          {[...customAnalytes].reverse().map((c) => {
            // A founded parameter's synonyms are exactly the printed names
            // filed under it: it is created with none and learns each one
            // through the same path as every other accepted mapping.
            const names = registry.get(c.canonicalId)?.synonyms ?? [];
            return (
              <li key={c.canonicalId}>
                <span>
                  <strong>{c.displayNameCs}</strong>
                  <span className="muted">
                    {prettyUnit(c.canonicalUnit) && <> · {prettyUnit(c.canonicalUnit)}</>}
                    {names.length > 0 && <> · {names.join(", ")}</>}
                  </span>
                </span>
                {confirming === c.canonicalId ? (
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    <button
                      className="btn danger small"
                      onClick={() => {
                        setConfirming(null);
                        onDelete(c.canonicalId);
                      }}
                    >
                      Smazat
                    </button>
                    <button className="btn small" onClick={() => setConfirming(null)}>
                      Zrušit
                    </button>
                  </span>
                ) : (
                  <button className="btn small" onClick={() => setConfirming(c.canonicalId)}>
                    Smazat
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}

export default function MappingTab({
  reports,
  registry,
  customAnalytes,
  onMap,
  onUndoMap,
  onCreateParameter,
  onDeleteParameter,
  onShowSource,
}: Props) {
  const unmapped = useMemo(() => findUnmapped(reports), [reports]);
  const stats = useMemo(() => observedStats(reports), [reports]);
  /** Names the reader chose to leave alone, kept out of the way but findable. */
  const [deferred, setDeferred] = useState<string[]>([]);
  /** The last acceptance, offered back for one click. */
  const [lastMap, setLastMap] = useState<{
    rawName: string;
    canonicalId: string;
    /** Founding a parameter is undone by deleting it, not by unmapping. */
    founded: boolean;
  } | null>(null);

  const pending = unmapped.filter((a) => !deferred.includes(a.rawName));
  const held = unmapped.filter((a) => deferred.includes(a.rawName));

  const assign = (rawName: string, canonicalId: string) => {
    onMap(rawName, canonicalId);
    setLastMap({ rawName, canonicalId, founded: false });
  };

  const found = (rawName: string, c: CustomAnalyte) => {
    onCreateParameter(rawName, c);
    setLastMap({ rawName, canonicalId: c.canonicalId, founded: true });
  };

  const undoLast = () => {
    if (!lastMap) return;
    if (lastMap.founded) onDeleteParameter(lastMap.canonicalId);
    else onUndoMap(lastMap.rawName, lastMap.canonicalId);
    setLastMap(null);
  };

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Přiřazení názvů parametrů</h2>
            <p className="sub" style={{ marginBottom: 0 }}>
              {unmapped.length === 0
                ? "Všechny názvy z dokumentů odpovídají známým parametrům — není co řešit."
                : `Tyto názvy zatím neznáme, takže se neobjeví v trendech. U každého vidíte, ` +
                  `co pro navržený parametr mluví a co proti — jednotka, referenční rozmezí, ` +
                  `materiál a řád naměřených hodnot — abyste mohli posoudit, jestli jde ` +
                  `opravdu o totéž vyšetření. Jde-li o vyšetření, které aplikace ještě ` +
                  `nezná, můžete z názvu založit nový parametr.`}
            </p>
          </div>
          {pending.length > 0 && (
            <span className="chip count-chip">
              {count(pending.length, "název čeká", "názvy čekají", "názvů čeká")}
            </span>
          )}
        </div>

        {lastMap && (
          <p className="banner undo-banner">
            <span>
              <strong>{lastMap.rawName}</strong>{" "}
              {lastMap.founded ? "je nyní nový parametr" : "je nyní součástí parametru"}{" "}
              <strong>{registry.displayName(lastMap.canonicalId)}</strong>.
            </span>
            <button className="btn small" onClick={undoLast}>
              Vrátit zpět
            </button>
          </p>
        )}
      </div>

      {pending.map((a) => (
        <UnmappedCard
          key={a.rawName}
          a={a}
          cands={suggestMappings(a, registry, stats)}
          registry={registry}
          customAnalytes={customAnalytes}
          onMap={assign}
          onCreate={found}
          onShowSource={onShowSource}
          onDefer={() => setDeferred((d) => [...d, a.rawName])}
        />
      ))}

      {held.length > 0 && (
        <div className="card held-card">
          <details>
            <summary className="section-title">
              Ponechané bez přiřazení ({held.length})
            </summary>
            <p className="muted" style={{ marginTop: 8 }}>
              Nepřiřazený parametr se nikam neztratí — zůstane v Ověření u svého dokumentu,
              jen se nezobrazí v trendech, protože ho nelze spolehlivě porovnat mezi odběry.
            </p>
            <ul className="held-list">
              {held.map((a) => (
                <li key={a.rawName}>
                  <span>{a.rawName}</span>
                  <button
                    className="btn small"
                    onClick={() => setDeferred((d) => d.filter((n) => n !== a.rawName))}
                  >
                    Vrátit k rozhodnutí
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {customAnalytes.length > 0 && (
        <CustomParams
          customAnalytes={customAnalytes}
          registry={registry}
          onDelete={(id) => {
            if (lastMap?.canonicalId === id) setLastMap(null);
            onDeleteParameter(id);
          }}
        />
      )}
    </>
  );
}
