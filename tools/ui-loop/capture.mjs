/**
 * Capture canned conversations from the dev agent worker into fixtures.
 *
 * Runs against localhost only, with the Turnstile testing secret accepting a
 * dummy token — a fixture is the SSE event log of a real turn, recorded
 * verbatim. Synthetic patients only: fixtures are committed, and the one real
 * record must never appear in one.
 *
 *   node tools/ui-loop/capture.mjs [base]   # default http://localhost:8788
 */
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const BASE = args.find((a) => a.startsWith("http")) ?? "http://localhost:8788";

/** The sidebar conversations, three per practice — see docs/plans/chat-ui.md §2. */
const CONVERSATIONS = [
  { tenant: "sport", slug: "hruby-souhrn", title: "Souhrn — Tomáš Hrubý",
    turns: ["Dej mi souhrn Tomáše Hrubého."] },
  { tenant: "sport", slug: "palan-graf", title: "Hemoglobin v grafu — V. Palán",
    turns: ["Ukaž hemoglobin Vojtěcha Palána v grafu."] },
  { tenant: "sport", slug: "sebestova-ferritin", title: "Ferritin v sezóně — K. Šebestová",
    turns: ["Jak se vyvíjel ferritin Kláry Šebestové?"] },
  { tenant: "orto", slug: "novak-dva", title: "Dva Michalové Novákové",
    turns: ["Dej mi souhrn Michala Nováka.", "Toho narozeného v roce 1988."] },
  { tenant: "orto", slug: "vondrusak-dokumentace", title: "Dokumentace — P. Vondrušák",
    turns: ["Shrň dokumentaci Petra Vondrušáka."] },
  { tenant: "orto", slug: "predoperacni-mimo", title: "Hemoglobin pod rozmezím — kartotéka",
    turns: ["Kteří pacienti mají hemoglobin pod referenčním rozmezím?"] },
];

async function mintSession() {
  const res = await fetch(`${BASE}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ turnstileToken: "XXXX.DUMMY" }),
  });
  if (!res.ok) throw new Error(`session: ${res.status} ${await res.text()}`);
  return (await res.json()).session;
}

/** Minimal SSE reader — frames split anywhere, hold the tail until its blank line. */
async function* readSse(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (line) yield JSON.parse(line.slice(6));
    }
  }
}

const session = await mintSession();
let spent = 0;

for (const conv of CONVERSATIONS) {
  if (only && conv.slug !== only) continue;
  const fixture = { title: conv.title, tenant: conv.tenant, turns: [] };
  const history = [];
  let patientRef;
  for (const user of conv.turns) {
    history.push({ role: "user", content: user });
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-session": session },
      body: JSON.stringify({
        profile: "clinical", history, tenant: conv.tenant,
        ...(patientRef ? { patientRef } : {}),
      }),
    });
    if (!res.ok) throw new Error(`${conv.slug}: ${res.status} ${await res.text()}`);
    const events = [];
    let answer = "";
    for await (const ev of readSse(res.body)) {
      events.push(ev);
      if (ev.type === "text") answer += ev.text;
      if (ev.type === "patient") patientRef = ev.ref;
      if (ev.type === "error") throw new Error(`${conv.slug}: agent error: ${ev.message}`);
    }
    history.push({ role: "assistant", content: answer });
    fixture.turns.push({ user, events });
    const done = events.find((e) => e.type === "done");
    if (done?.usage?.costUsd) spent += done.usage.costUsd;
    console.log(`  ${conv.slug} turn ok — ${events.length} events`);
  }
  const dir = `apps/chat/src/fixtures/${conv.tenant}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${conv.slug}.json`, JSON.stringify(fixture, null, 1) + "\n");
  console.log(`${conv.slug} written`);
}
console.log(`captured; reported cost ≈ $${spent.toFixed(3)}`);
