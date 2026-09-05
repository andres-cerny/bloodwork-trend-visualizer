/**
 * Sdílet s AI: one sentence to copy into ChatGPT, Claude or any assistant
 * that can fetch a page, pointing at a private, temporary text page of the
 * person's own values.
 *
 * The text is built here, in the browser, by lab-core's `buildAiShare` from
 * the same payloads every other tab reads, and the worker stores it
 * verbatim — so "Co AI uvidí" shows exactly the bytes that get served, and
 * the worker still never reads a value out of a payload. The URL is shown
 * once: the worker keeps only the token's hash. The sentence lives in this
 * tab's sessionStorage, so a reload in the same tab still has it, and a new
 * tab or another device is told a link exists and offered a fresh one.
 *
 * Four states: no link; a link made here (the sentence, copy, revoke, the
 * expiry, the preview); a link made elsewhere (the expiry, a fresh link,
 * revoke); and nothing yet, while the worker is asked. Copy above the
 * button is for someone who has never heard the word "URL": click, copy,
 * paste into your assistant, ask.
 */
import { useEffect, useMemo, useState } from "react";
import { type LabReport, type Trend, buildAiShare, count } from "@bw/lab-core";
import { type AiShare, createAiShare, getAiShare, revokeAiShare } from "../lib/api";

interface Props {
  reports: LabReport[];
  trends: Map<string, Trend>;
}

/** What this tab remembers: the link, when it dies, and the text behind it. */
interface Kept extends AiShare {
  text: string;
}

const KEY = "mk-ai-share";
const PREVIEW_ROWS = 5;

function readKept(): Kept | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const k = JSON.parse(raw) as Kept;
    return typeof k.url === "string" && typeof k.expiresAt === "string" && typeof k.text === "string" ? k : null;
  } catch {
    return null;
  }
}

function writeKept(k: Kept | null) {
  try {
    if (k) sessionStorage.setItem(KEY, JSON.stringify(k));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* a browser that refuses storage still gets the link on screen */
  }
}

/** "6. 9. 2026 14:32", in the reader's own clock. */
function czDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} ${d.getHours()}:${two(d.getMinutes())}`;
}

const sentenceFor = (url: string) => `Načti moje výsledky krve z ${url} a pomoz mi jim porozumět.`;

/** The table rows of the stored text, cell by cell — the text is the truth,
 *  so the preview is parsed from it rather than rebuilt beside it. */
function rowsOf(text: string): string[][] {
  const lines = text.split("\n");
  const head = lines.findIndex((l) => l.startsWith("Analyt | "));
  if (head < 0) return [];
  return lines
    .slice(head + 1)
    .filter((l) => l.includes(" | "))
    .map((l) => l.split(" | "));
}

export default function ShareTab({ reports, trends }: Props) {
  const text = useMemo(() => buildAiShare(reports, trends), [reports, trends]);
  const [kept, setKept] = useState<Kept | null>(() => (typeof sessionStorage === "undefined" ? null : readKept()));
  // undefined: not asked yet; null: no live link on the account.
  const [remote, setRemote] = useState<{ expiresAt: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAiShare().then(setRemote, () => setRemote(null));
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  const alive = (iso: string) => Date.parse(iso) > Date.now();
  // The sentence is only offered while the worker agrees the link is live:
  // a link revoked from another device is not one to paste anywhere.
  const mine = kept && remote && kept.expiresAt === remote.expiresAt && alive(kept.expiresAt) ? kept : null;
  const elsewhere = !mine && remote && alive(remote.expiresAt) ? remote : null;

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const share = await createAiShare(text);
      const k = { ...share, text };
      writeKept(k);
      setKept(k);
      setRemote({ expiresAt: share.expiresAt });
      setCopied(false);
    } catch {
      setError("Odkaz se nepodařilo vytvořit. Zkontrolujte připojení a zkuste to znovu.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await revokeAiShare();
      writeKept(null);
      setKept(null);
      setRemote(null);
    } catch {
      setError("Odkaz se nepodařilo zrušit. Zkuste to prosím znovu.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(sentence: string) {
    try {
      await navigator.clipboard.writeText(sentence);
      setCopied(true);
    } catch {
      // No clipboard permission: select the line so a long-press or ⌘C
      // takes it, and say so rather than claim it was copied.
      const el = document.querySelector(".ai-line");
      const sel = window.getSelection();
      if (el && sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      setError("Schránka není dostupná — věta je označená, zkopírujte ji ručně.");
    }
  }

  const foot = (
    <p className="ai-foot">
      Odkaz je náhodný a neveřejný — kdo ho nezná, nic neuvidí. <a href="/soukromi">Co sdílíme, a co ne.</a>
    </p>
  );

  if (remote === undefined) {
    return (
      <div className="card ai-share">
        <div className="card-head">
          <div>
            <h2>Sdílet s AI</h2>
          </div>
        </div>
        <p className="muted">Načítám…</p>
      </div>
    );
  }

  if (mine) {
    const sentence = sentenceFor(mine.url);
    const rows = rowsOf(mine.text);
    const rest = rows.length - PREVIEW_ROWS;
    return (
      <div className="card ai-share">
        <div className="card-head">
          <div>
            <h2>Sdílet s AI</h2>
            <p className="sub" style={{ marginBottom: 0 }}>
              Zkopírujte větu a vložte ji do ChatGPT, Claude nebo jiného asistenta. Výsledky si načte sám.
            </p>
          </div>
        </div>
        <p className="ai-line">{sentence}</p>
        <div className="toolbar">
          {copied ? (
            <button className="btn" onClick={() => void copy(sentence)}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 8.5l3.2 3.2L13 4.8" />
              </svg>
              Zkopírováno
            </button>
          ) : (
            <button className="btn primary" onClick={() => void copy(sentence)}>
              Zkopírovat
            </button>
          )}
          <button className="btn" disabled={busy} onClick={() => void revoke()}>
            Zrušit odkaz
          </button>
        </div>
        {error && <p className="banner warn" style={{ margin: "10px 0 0" }}>{error}</p>}
        <p className="muted" style={{ margin: "10px 0 0" }}>
          Odkaz platí do {czDateTime(mine.expiresAt)} — pak přestane fungovat. Nový vytvoříte kdykoli.
        </p>

        <details style={{ marginTop: 14 }}>
          <summary>Co AI uvidí</summary>
          <p className="muted" style={{ margin: "8px 0 6px" }}>
            Prostý text, bez jména a bez PDF.{" "}
            {rows.length > PREVIEW_ROWS ? `Prvních ${PREVIEW_ROWS} z ${count(rows.length, "parametr", "parametry", "parametrů")}:` : `${count(rows.length, "parametr", "parametry", "parametrů")}:`}
          </p>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Parametr</th>
                  <th className="ai-unit-col">Jednotka</th>
                  <th>Referenční meze</th>
                  <th>Hodnoty</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r[0]}
                      <span className="ai-unit muted">{r[1]}</span>
                    </td>
                    <td className="num ai-unit-col">{r[1]}</td>
                    <td className="num">{r[2]}</td>
                    <td className="ai-vals">
                      {r
                        .slice(3)
                        .join(" | ")
                        .split("; ")
                        .map((v, j) => (
                          <span key={j}>{v}</span>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rest > 0 && (
            <p className="muted" style={{ margin: "8px 0 0" }}>
              … a {count(rest, "další parametr", "další parametry", "dalších parametrů")} stejným způsobem.
            </p>
          )}
          <details style={{ marginTop: 10 }}>
            <summary>Celý text, přesně jak je uložený</summary>
            <pre className="ai-raw">{mine.text}</pre>
          </details>
        </details>
        {foot}
      </div>
    );
  }

  if (elsewhere) {
    return (
      <div className="card ai-share">
        <div className="card-head">
          <div>
            <h2>Sdílet s AI</h2>
            <p className="sub" style={{ marginBottom: 0 }}>
              Odkaz pro AI už existuje — vytvořený v jiné záložce nebo na jiném zařízení, a věta s ním
              zůstala tam. Tady můžete vytvořit nový (starý tím přestane platit) nebo ho zrušit.
            </p>
          </div>
        </div>
        <div className="toolbar">
          <button className="btn primary" disabled={busy} onClick={() => void mint()}>
            Vytvořit nový odkaz
          </button>
          <button className="btn" disabled={busy} onClick={() => void revoke()}>
            Zrušit odkaz
          </button>
        </div>
        {error && <p className="banner warn" style={{ margin: "10px 0 0" }}>{error}</p>}
        <p className="muted" style={{ margin: "10px 0 0" }}>
          Stávající odkaz platí do {czDateTime(elsewhere.expiresAt)} — pak přestane fungovat.
        </p>
        {foot}
      </div>
    );
  }

  return (
    <div className="card ai-share">
      <div className="card-head">
        <div>
          <h2>Sdílet s AI</h2>
          <p className="sub" style={{ marginBottom: 0 }}>
            Váš AI asistent — ChatGPT, Claude nebo jiný — si výsledky přečte z dočasného odkazu, který tu
            vytvoříte. Stačí kliknout, zkopírovat větu, vložit ji do svého asistenta a ptát se. Odchází jen
            hodnoty, jednotky, referenční meze a data odběrů. Žádné PDF, žádné jméno.
          </p>
        </div>
      </div>
      <div className="toolbar">
        <button className="btn primary" disabled={busy || reports.length === 0} onClick={() => void mint()}>
          Vytvořit odkaz pro AI
        </button>
        <span className="muted">Odkaz platí 24 hodin a kdykoli ho můžete zrušit.</span>
      </div>
      {error && <p className="banner warn" style={{ margin: "10px 0 0" }}>{error}</p>}
      {foot}
    </div>
  );
}
