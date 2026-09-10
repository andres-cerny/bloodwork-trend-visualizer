/**
 * Capture the portal fixture from the locally seeded /csm database.
 *
 * Talks to the dev agent (npm run dev:agent), minting a session through the
 * normal door — dev runs the Turnstile testing key, which accepts a dummy
 * token, so the capture uses the same path a browser would. The output is
 * the committed fixture the whole UI tournament renders from.
 *
 * GHOSTS ONLY: the fixture is committed, so the real record must not be in
 * the local database when this runs — it never is, before deploy-time
 * seeding — and the guard below refuses the known real name outright.
 *
 *   node tools/ui-loop/portal-capture.mjs [--base http://127.0.0.1:8788]
 *       [--out apps/csm-portal/src/fixtures/portal.json]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const BASE = arg("base", "http://127.0.0.1:8788");
const OUT = arg("out", "apps/csm-portal/src/fixtures/portal.json");
const TENANT = "csm";

const sessionRes = await fetch(`${BASE}/api/session`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ turnstileToken: "XXXX.DUMMY" }),
});
if (!sessionRes.ok) {
  throw new Error(`session: ${sessionRes.status} — is dev:agent running with the testing key?`);
}
const { session } = await sessionRes.json();

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { "x-demo-session": session } });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${data.error ?? ""}`);
  return data;
}

const { patients } = await get(`/api/card/patients?tenant=${TENANT}`);
if (patients.length === 0) throw new Error("csm database is empty — seed it first");
for (const p of patients) {
  if (/černý|cerny/i.test(p.fullName)) {
    throw new Error(`REFUSED: real record (${p.fullName}) present — fixtures hold ghosts only`);
  }
}

const fixture = { patients, byPatient: {} };
for (const p of patients) {
  const { visits } = await get(`/api/card/visits?tenant=${TENANT}&patient=${p.id}`);
  const details = {};
  const documents = {};
  const trends = {};
  for (const v of visits) {
    const d = await get(`/api/card/visit?tenant=${TENANT}&patient=${p.id}&visit=${v.id}`);
    details[v.id] = d;
    if (d.note) documents[d.note.id] = d.note;
  }
  // Every lab analyte seen at any visit, plus every perf metric.
  const labIds = new Set();
  const perfIds = new Set();
  for (const d of Object.values(details)) {
    for (const l of d.labs) labIds.add(l.canonicalId);
    for (const r of d.perf) perfIds.add(r.metricId);
  }
  for (const id of labIds) {
    trends[`lab:${id}`] = await get(
      `/api/card/trend?tenant=${TENANT}&patient=${p.id}&kind=lab&metric=${id}`,
    );
  }
  for (const id of perfIds) {
    trends[`perf:${id}`] = await get(
      `/api/card/trend?tenant=${TENANT}&patient=${p.id}&kind=perf&metric=${id}`,
    );
  }
  fixture.byPatient[p.id] = { visits, details, trends, documents };
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(fixture, null, 1) + "\n");
const kb = Math.round(JSON.stringify(fixture).length / 1024);
console.log(`fixture written → ${OUT} (${patients.length} patients, ${kb} KB)`);
