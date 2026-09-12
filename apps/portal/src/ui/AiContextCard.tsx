/**
 * Doplnit kontext pro AI: the second card on the AI konzultace tab, under the
 * link. What a person tells their assistant about themselves, once; saved
 * on the account and carried by every link after (docs/plans/moje-krev-ai-context.md).
 *
 * Three states. Nothing saved: the form, open. Saved: one line saying what
 * the AI knows, and Upravit. Editing: the form again, over the saved values,
 * with Uložit and Zrušit. Every sentence the card shows about the person —
 * the summary line, the text the page carries — comes from lab-core's
 * aiContext, so the form and the text cannot disagree.
 */
import { useEffect, useState } from "react";
import {
  AGE_BANDS,
  ALCOHOL_OPTIONS,
  DIAGNOSIS_CHIPS,
  GOAL_OPTIONS,
  HEIGHT_CM,
  MED_CHIPS,
  SEX_OPTIONS,
  SMOKING_OPTIONS,
  WEIGHT_KG,
  aiContextSummary,
  capitalize,
  isEmptyAiContext,
  normalizeAiContext,
  type AiContext,
} from "@bw/lab-core";

interface Props {
  value: AiContext | null;
  /** Save the (normalized) context; rejects when the account did not take it. */
  onSave: (ctx: AiContext) => Promise<void>;
}

const toggle = <T,>(list: T[] | undefined, id: T): T[] =>
  list?.includes(id) ? list.filter((x) => x !== id) : [...(list ?? []), id];

/** A number field's text: "" for nothing, digits otherwise. */
const numText = (n: number | undefined) => (n === undefined ? "" : String(n));
const numOf = (s: string): number | undefined => {
  const n = Number(s.replace(",", "."));
  return s.trim() && Number.isFinite(n) ? n : undefined;
};

export default function AiContextCard({ value, onSave }: Props) {
  const saved =
    value && !isEmptyAiContext(value) ? normalizeAiContext(value) : null;
  const [editing, setEditing] = useState(saved === null);
  const [draft, setDraft] = useState<AiContext>(saved ?? {});
  const [height, setHeight] = useState(numText(saved?.heightCm));
  const [weight, setWeight] = useState(numText(saved?.weightKg));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A context that arrives after mount (another device saved it) shows as saved.
  useEffect(() => {
    if (saved && !editing) {
      setDraft(saved);
      setHeight(numText(saved.heightCm));
      setWeight(numText(saved.weightKg));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const set = <K extends keyof AiContext>(k: K, v: AiContext[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  function startEdit() {
    setDraft(saved ?? {});
    setHeight(numText(saved?.heightCm));
    setWeight(numText(saved?.weightKg));
    setError(null);
    setEditing(true);
  }

  /** The browser's own validation bubble speaks the browser's language;
   *  the form is noValidate and the two numbers are checked here, in Czech. */
  function boundsError(): string | null {
    const h = numOf(height);
    if (height.trim() && (h === undefined || h < HEIGHT_CM[0] || h > HEIGHT_CM[1])) return `Výška: číslo od ${HEIGHT_CM[0]} do ${HEIGHT_CM[1]} cm.`;
    const w = numOf(weight);
    if (weight.trim() && (w === undefined || w < WEIGHT_KG[0] || w > WEIGHT_KG[1])) return `Váha: číslo od ${WEIGHT_KG[0]} do ${WEIGHT_KG[1]} kg.`;
    return null;
  }

  async function save() {
    const bad = boundsError();
    if (bad) {
      setError(bad);
      return;
    }
    const next = normalizeAiContext({
      ...draft,
      heightCm: numOf(height),
      weightKg: numOf(weight),
    });
    setBusy(true);
    setError(null);
    try {
      await onSave(next);
      // Nothing answered stays an open form: there is nothing to summarise.
      if (!isEmptyAiContext(next)) setEditing(false);
    } catch {
      setError(
        "Uložení se nepodařilo. Zkontrolujte připojení a zkuste to znovu.",
      );
    } finally {
      setBusy(false);
    }
  }

  const head = (
    <div className="card-head">
      <div>
        <h2>
          Doplnit kontext pro AI <span className="chip">nepovinné</span>
        </h2>
        <p className="sub">
          AI čte výsledky lépe, když ví, kdo jste, a má co nejvíc souvislostí —
          krev sportovce se vykládá jinak než krev člověka z kanceláře.
        </p>
        <p className="sub" style={{ marginBottom: 0 }}>
          Uloží se k vašemu účtu — bez jména, anonymně — takže až budete příště
          potřebovat nový odkaz, nic znovu nevyplňujete.
        </p>
      </div>
    </div>
  );

  if (!editing && saved) {
    return (
      <div className="card ai-share ai-context">
        <div className="card-head">
          <div>
            <h2>Co AI o vás ví</h2>
          </div>
        </div>
        <div className="ctx-summary">
          <span className="ctx-summary-text">{aiContextSummary(saved)}</span>
          <button className="btn linkish" onClick={startEdit}>
            Upravit
          </button>
        </div>
      </div>
    );
  }

  const opt = (s: string) => <span className="ctx-opt"> · {s}</span>;

  return (
    <div className="card ai-share ai-context">
      {head}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="ctx-field">
          <span className="ctx-label" id="ctx-sex">
            Pohlaví
          </span>
          <div className="ctx-seg" role="group" aria-labelledby="ctx-sex">
            {SEX_OPTIONS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`pick${draft.sex === id ? " on" : ""}`}
                aria-pressed={draft.sex === id}
                onClick={() => set("sex", draft.sex === id ? undefined : id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="ctx-row2">
          <div className="ctx-field">
            <label className="ctx-label" htmlFor="ctx-age">
              Věk
            </label>
            <select
              id="ctx-age"
              value={draft.ageBand ?? ""}
              onChange={(e) =>
                set(
                  "ageBand",
                  (e.target.value || undefined) as AiContext["ageBand"],
                )
              }
            >
              <option value="">Neuvedeno</option>
              {AGE_BANDS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="ctx-field">
            <label className="ctx-label" htmlFor="ctx-goal">
              Zajímá mě
            </label>
            <select
              id="ctx-goal"
              value={draft.goal ?? ""}
              onChange={(e) =>
                set("goal", (e.target.value || undefined) as AiContext["goal"])
              }
            >
              <option value="">Neuvedeno</option>
              {GOAL_OPTIONS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="ctx-row2">
          <div className="ctx-field">
            <label className="ctx-label" htmlFor="ctx-height">
              Výška
            </label>
            <div className="ctx-unit">
              <input
                id="ctx-height"
                type="number"
                inputMode="numeric"
                min={HEIGHT_CM[0]}
                max={HEIGHT_CM[1]}
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
              <span>cm</span>
            </div>
          </div>
          <div className="ctx-field">
            <label className="ctx-label" htmlFor="ctx-weight">
              Váha
            </label>
            <div className="ctx-unit">
              <input
                id="ctx-weight"
                type="number"
                inputMode="numeric"
                min={WEIGHT_KG[0]}
                max={WEIGHT_KG[1]}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
              <span>kg</span>
            </div>
          </div>
        </div>

        <div className="ctx-field">
          <label className="ctx-label" htmlFor="ctx-activity">
            Pohyb
          </label>
          <input
            id="ctx-activity"
            type="text"
            maxLength={300}
            placeholder="Co děláte a kolik hodin týdně — např. běh 3× týdně, posilovna 2×"
            value={draft.activity ?? ""}
            onChange={(e) => set("activity", e.target.value)}
          />
        </div>

        <div className="ctx-field">
          <span className="ctx-label" id="ctx-meds">
            Léky a doplňky{opt("nepovinné")}
          </span>
          <div className="ctx-picks" role="group" aria-labelledby="ctx-meds">
            {MED_CHIPS.map(([id, label]) => {
              const on = draft.meds?.includes(id) ?? false;
              return (
                <button
                  key={id}
                  type="button"
                  className={`pick${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() => set("meds", toggle(draft.meds, id))}
                >
                  {capitalize(label)}
                </button>
              );
            })}
          </div>
          <input
            type="text"
            className="ctx-more"
            maxLength={300}
            aria-label="Další léky a doplňky"
            placeholder="Další — název stačí"
            value={draft.medsOther ?? ""}
            onChange={(e) => set("medsOther", e.target.value)}
          />
        </div>

        <div className="ctx-field">
          <span className="ctx-label" id="ctx-dx">
            Diagnózy{opt("nepovinné")}
          </span>
          <div className="ctx-picks" role="group" aria-labelledby="ctx-dx">
            {DIAGNOSIS_CHIPS.map(([id, label]) => {
              const on = draft.diagnoses?.includes(id) ?? false;
              return (
                <button
                  key={id}
                  type="button"
                  className={`pick${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() => set("diagnoses", toggle(draft.diagnoses, id))}
                >
                  {capitalize(label)}
                </button>
              );
            })}
          </div>
          <input
            type="text"
            className="ctx-more"
            maxLength={300}
            aria-label="Jiné diagnózy"
            placeholder="Jiné, co má AI vědět"
            value={draft.diagnosesOther ?? ""}
            onChange={(e) => set("diagnosesOther", e.target.value)}
          />
        </div>

        <div className="ctx-row2">
          <div className="ctx-field">
            <label className="ctx-label" htmlFor="ctx-smoking">
              Kouření
            </label>
            <select
              id="ctx-smoking"
              value={draft.smoking ?? ""}
              onChange={(e) =>
                set(
                  "smoking",
                  (e.target.value || undefined) as AiContext["smoking"],
                )
              }
            >
              <option value="">Neuvedeno</option>
              {SMOKING_OPTIONS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="ctx-field">
            <label className="ctx-label" htmlFor="ctx-alcohol">
              Alkohol
            </label>
            <select
              id="ctx-alcohol"
              value={draft.alcohol ?? ""}
              onChange={(e) =>
                set(
                  "alcohol",
                  (e.target.value || undefined) as AiContext["alcohol"],
                )
              }
            >
              <option value="">Neuvedeno</option>
              {ALCOHOL_OPTIONS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="ctx-field">
          <label className="ctx-label" htmlFor="ctx-note">
            Poznámka pro AI{opt("nepovinné")}
          </label>
          <textarea
            id="ctx-note"
            maxLength={300}
            rows={3}
            placeholder="Cokoli, co má AI vědět — třeba že odběr byl den po závodě."
            value={draft.note ?? ""}
            onChange={(e) => set("note", e.target.value)}
          />
        </div>

        <div className="toolbar" style={{ marginTop: 14 }}>
          <button type="submit" className="btn primary" disabled={busy}>
            Uložit a přidat k odkazu
          </button>
          {saved && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Zrušit
            </button>
          )}
        </div>
        {error && (
          <p className="banner warn" style={{ margin: "10px 0 0" }}>
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
