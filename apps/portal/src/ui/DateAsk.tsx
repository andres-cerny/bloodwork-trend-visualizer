/**
 * A report was stored without a date, and the person is asked for it at once
 * — with the page beside the question, so the date can be read off it.
 *
 * Without a date a report is left out of every trend (lab-core trends.ts), and
 * nothing used to say so: the values were "uloženo" and never seen again.
 * „Později" is allowed; the report then waits in Reporty with ⚠️ and a way to
 * Ověření, where the same field is.
 */
import { useEffect, useRef, useState } from "react";
import type { LabReport } from "@bw/lab-core";

interface Props {
  report: LabReport;
  /** More reports behind this one waiting for the same question. */
  more: number;
  onSave: (isoDate: string) => void;
  onLater: () => void;
}

export default function DateAsk({ report, more, onSave, onLater }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const laterRef = useRef(onLater);
  laterRef.current = onLater;
  const today = new Date().toISOString().slice(0, 10);
  const page = report.pages[0];

  useEffect(() => {
    setValue("");
    inputRef.current?.focus();
  }, [report.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") laterRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= today && value >= "1990-01-01";

  return (
    <div className="sheet-back">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="date-ask-title">
        <div className="sheet-head">
          <h2 id="date-ask-title">Doplňte datum odběru</h2>
        </div>
        <p className="sub" style={{ margin: 0 }}>
          V nahraném reportu se datum nenašlo. Bez něj se hodnoty neukážou v trendech — najděte ho
          prosím na stránce (obvykle „Datum odběru" nebo „Odběr").
          {more > 0 && ` Čeká ještě ${more === 1 ? "1 další report" : `${more} další reporty`}.`}
        </p>
        {page?.imageUrl && <img className="date-ask-img" src={page.imageUrl} alt="První strana reportu" />}
        <form
          className="date-ask-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onSave(value);
          }}
        >
          <label>
            Datum odběru
            <input ref={inputRef} type="date" value={value} max={today} min="1990-01-01" onChange={(e) => setValue(e.target.value)} required />
          </label>
          <button className="btn primary" disabled={!valid}>
            Uložit datum
          </button>
          <button type="button" className="btn" onClick={onLater}>
            Později
          </button>
        </form>
      </div>
    </div>
  );
}
