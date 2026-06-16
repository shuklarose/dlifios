// monitor.ts — Day 11: the daily "watch" loop that makes the system feed itself.
// It ties together two pieces we already built:
//   findNewActs(since)  (Day 3) — SPARQL: "what data-protection acts are new?"
//   ingestCelex(celex)  (Day 11) — fetch -> chunk -> embed -> store one act
// plus hasCelex() so it's idempotent (never re-ingests an act it already has).
// The Hono /monitor route calls monitorNewActs(); n8n's daily cron hits that.

import { fileURLToPath } from "node:url";

import { findNewActs } from "./sources/eurlex.ts";
import { ingestCelex, hasCelex } from "./store.ts";

export interface MonitorResult {
  since: string;
  found: number; // how many acts SPARQL returned
  ingested: { celex: string; title: string; date: string; chunks: number }[];
  skipped: { celex: string; title: string; reason: string }[];
}

// Check for acts newer than `since` (YYYY-MM-DD) and ingest any we don't have.
export async function monitorNewActs(since: string): Promise<MonitorResult> {
  const acts = await findNewActs(since);
  const ingested: MonitorResult["ingested"] = [];
  const skipped: MonitorResult["skipped"] = [];

  for (const act of acts) {
    // Idempotency: don't re-ingest something already in the corpus.
    if (await hasCelex(act.celex)) {
      skipped.push({ celex: act.celex, title: act.title, reason: "already in corpus" });
      continue;
    }

    try {
      const chunks = await ingestCelex(act.celex, act.celex);
      if (chunks === 0) {
        // No article markup (a decision/corrigendum, not a structured act).
        skipped.push({ celex: act.celex, title: act.title, reason: "no article structure" });
      } else {
        ingested.push({ celex: act.celex, title: act.title, date: act.date, chunks });
      }
    } catch (err) {
      skipped.push({
        celex: act.celex,
        title: act.title,
        reason: `ingest failed: ${(err as Error).message}`,
      });
    }
  }

  return { since, found: acts.length, ingested, skipped };
}

// ---------- Demo: run with `npm run monitor` ----------

async function demo() {
  // Look back ~180 days (acts arrive in bursts; a wide window finds something).
  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  console.log(`Checking for data-protection acts since ${since}...\n`);

  const result = await monitorNewActs(since);

  console.log(`Found ${result.found} act(s) tagged data-protection.`);
  console.log(`Ingested ${result.ingested.length}, skipped ${result.skipped.length}.\n`);
  for (const a of result.ingested) console.log(`  + ${a.celex} (${a.chunks} chunks) — ${a.title}`);
  for (const s of result.skipped) console.log(`  · skip ${s.celex} [${s.reason}] — ${s.title}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  demo();
}
