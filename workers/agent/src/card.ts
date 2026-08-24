/**
 * The patient card's API — read-only JSON over a practice's database.
 *
 * Both new surfaces read the card through these routes: the portal for the
 * patient's own record, the doctor app's card tab for whichever patient is
 * pinned. No LLM is anywhere on this path, and no route costs a cent — which
 * is why the gate here is session validity alone, not the ledger: a frozen AI
 * budget promises "Ukázková data zůstávají dostupná", and these routes are
 * that data.
 *
 * Scoping is the server's: every handler validates the patient against this
 * tenant's directory before touching anything, and the stores it then builds
 * are constructed scoped to that one patient — there is no query with which
 * to ask about another. The card and the agent's tools must disagree about
 * nothing: lab numbers come from the same DatabaseSource + lab-core trends
 * the tools read, filtered by the same numericPoints rule the charts obey,
 * and a parity test pins it.
 */
import { verifySession } from "@bw/gate";
import { json } from "@bw/gate/http";
import { numericPoints } from "@bw/lab-core";
import {
  CardStore,
  D1DocumentStore,
  DatabaseSource,
  PatientDirectory,
  type D1Like,
  type PerfPoint,
} from "@bw/datasource";

interface VisitLabRow {
  canonicalId: string;
  displayName: string;
  unit: string;
  value: number;
  valueRaw: string;
  flag: string;
  refLow: number | null;
  refHigh: number | null;
  unconfirmed: boolean;
  delta: number | null;
  prevDate: string | null;
}

interface VisitPerfRow extends PerfPoint {
  delta: number | null;
  prevDate: string | null;
}

/** Previous numeric neighbour in a date-ordered series, for the delta rows. */
function deltaFrom<T>(series: T[], index: number, value: (t: T) => number, date: (t: T) => string) {
  const prev = index > 0 ? series[index - 1] : undefined;
  return prev === undefined
    ? { delta: null, prevDate: null }
    : { delta: value(series[index]) - value(prev), prevDate: date(prev) };
}

export async function handleCard(
  request: Request,
  env: { SESSION_SECRET: string },
  db: D1Like,
): Promise<Response> {
  const claims = await verifySession(env.SESSION_SECRET, request.headers.get("x-demo-session"));
  if (!claims) {
    return json(
      { error: "session_invalid", message: "Ověření vypršelo. Načtěte stránku znovu." },
      401,
    );
  }

  const url = new URL(request.url);
  const sub = url.pathname.slice("/api/card/".length);
  const directory = new PatientDirectory(db);

  if (sub === "patients") {
    // The picker's list — who exists, nothing more. The note column stays
    // server-side: it is practice-internal text, not card content.
    const patients = await directory.listPatients();
    return json({
      patients: patients.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        birthDate: p.birthDate,
        sex: p.sex,
      })),
    });
  }

  // Everything below is about one patient, and the ref must resolve in THIS
  // tenant's directory — a ref from another practice is indistinguishable
  // from one that never existed.
  const patient = await directory.getPatient(url.searchParams.get("patient") ?? "");
  if (!patient) return json({ error: "unknown_patient", message: "Neznámý pacient." }, 400);

  const source = new DatabaseSource(db, patient.id);
  const card = new CardStore(db, patient.id);
  const documents = new D1DocumentStore(db, patient.id);

  if (sub === "visits") {
    const [visits, analytes, perf] = await Promise.all([
      card.visits(),
      source.listAnalytes(),
      card.allPerf(),
    ]);
    // Lab flags per visit date, from the same filtered series the charts
    // plot — a suspect reading is neither shown nor counted.
    const byDate = new Map<string, { labs: number; outOfRange: number; unconfirmed: number }>();
    for (const a of analytes) {
      const trend = await source.getTrend(a.canonicalId);
      if (!trend) continue;
      for (const p of numericPoints(trend)) {
        const d = byDate.get(p.date) ?? { labs: 0, outOfRange: 0, unconfirmed: 0 };
        d.labs += 1;
        if (p.flag !== "normal") d.outOfRange += 1;
        if (p.unconfirmed !== null) d.unconfirmed += 1;
        byDate.set(p.date, d);
      }
    }
    const perfByVisit = new Map<string, number>();
    for (const p of perf) perfByVisit.set(p.visitId, (perfByVisit.get(p.visitId) ?? 0) + 1);
    return json({
      patient: { id: patient.id, fullName: patient.fullName, birthDate: patient.birthDate },
      visits: visits.map((v) => ({
        ...v,
        hasNote: v.noteDocumentId !== null,
        labCount: byDate.get(v.visitDate)?.labs ?? 0,
        outOfRange: byDate.get(v.visitDate)?.outOfRange ?? 0,
        unconfirmed: byDate.get(v.visitDate)?.unconfirmed ?? 0,
        perfCount: perfByVisit.get(v.id) ?? 0,
      })),
    });
  }

  if (sub === "visit") {
    const visitId = url.searchParams.get("visit") ?? "";
    const visit = (await card.visits()).find((v) => v.id === visitId);
    if (!visit) return json({ error: "unknown_visit" }, 404);

    // Labs drawn that day, each with its delta against the previous numeric
    // point of ITS OWN series — the previous comparable visit, not the
    // previous calendar entry.
    const labs: VisitLabRow[] = [];
    for (const a of await source.listAnalytes()) {
      const trend = await source.getTrend(a.canonicalId);
      if (!trend) continue;
      const series = numericPoints(trend);
      const i = series.findIndex((p) => p.date === visit.visitDate);
      if (i === -1) continue;
      const p = series[i];
      labs.push({
        canonicalId: trend.canonicalId,
        displayName: trend.displayName,
        unit: p.unit ?? trend.unit,
        value: p.value as number,
        valueRaw: p.valueRaw,
        flag: p.flag,
        refLow: p.refLow,
        refHigh: p.refHigh,
        unconfirmed: p.unconfirmed !== null,
        ...deltaFrom(series, i, (x) => x.value as number, (x) => x.date),
      });
    }

    const allPerf = await card.allPerf();
    const atVisit = allPerf.filter((p) => p.visitId === visit.id);
    const perfRows: VisitPerfRow[] = atVisit.map((p) => {
      const series = allPerf.filter((q) => q.metricId === p.metricId);
      const i = series.findIndex((q) => q.visitId === p.visitId);
      return { ...p, ...deltaFrom(series, i, (x) => x.value, (x) => x.testDate) };
    });

    const note = visit.noteDocumentId ? await documents.getDocument(visit.noteDocumentId) : null;
    return json({ visit, labs, perf: perfRows, note });
  }

  if (sub === "trend") {
    const metric = url.searchParams.get("metric") ?? "";
    const kind = url.searchParams.get("kind");
    if (kind === "lab") {
      const trend = await source.getTrend(metric);
      if (!trend) return json({ error: "unknown_metric" }, 404);
      return json({
        kind: "lab",
        canonicalId: trend.canonicalId,
        displayName: trend.displayName,
        unit: trend.unit,
        points: numericPoints(trend),
      });
    }
    if (kind === "perf") {
      const points = await card.perfTrend(metric);
      if (points.length === 0) return json({ error: "unknown_metric" }, 404);
      return json({
        kind: "perf",
        metricId: points[0].metricId,
        displayName: points[0].displayName,
        unit: points[0].unit,
        points,
      });
    }
    // lab or perf, stated — an unstated kind would need a default, and a
    // metric id that collides across the two worlds would then pick one.
    return json({ error: "unknown_kind" }, 400);
  }

  if (sub === "document") {
    const doc = await documents.getDocument(url.searchParams.get("doc") ?? "");
    if (!doc) return json({ error: "unknown_document" }, 404);
    return json({ document: doc });
  }

  return json({ error: "not_found" }, 404);
}
