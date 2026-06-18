// server.ts — Day 9: expose the RAG system over HTTP with Hono.
// Until now ask() and ingestGdpr() only ran from the CLI. This turns them into
// "doors" other programs can knock on: n8n (Days 10-12) and the UI (Day 13)
// will POST to these routes instead of importing our code.
//
//   POST /ask     { "question": "...", "k"?: number }       -> { answer, sources }
//   POST /ingest  { "celex"?, "source"?, "reset"? }          -> { stored, celex, source }
//   POST /monitor { "since"?: "YYYY-MM-DD" }                  -> { since, found, ingested, skipped }
//   POST /digest  { "since"?: "YYYY-MM-DD" }                  -> { since, subject, body, acts, guidance }
//   GET  /                                                   -> the chat UI (Day 13)
//   GET  /health                                             -> health/info

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ask } from "./answer.ts";
import { ingestCelex, ingestGdpr } from "./store.ts";
import { monitorNewActs } from "./monitor.ts";
import { buildDigest } from "./digest.ts";

// A Hono app is just a collection of routes. Each handler gets a "context" `c`
// holding the request and helpers to build the response (c.json, c.req, etc.).
const app = new Hono();

// The chat UI (Day 13). Served from the SAME origin as /ask, so the page can
// fetch("/ask") with no CORS and no hardcoded URL — and it deploys with the API.
// Resolve the path relative to this file (src/) so cwd doesn't matter.
const UI_PATH = fileURLToPath(new URL("../public/index.html", import.meta.url));
app.get("/", (c) => c.html(readFileSync(UI_PATH, "utf8")));

// Static assets — logo, globe render, etc. live in public/assets and are served
// at /assets/*. `root` is relative to the cwd the server starts from, which is
// the project root when launched via `npm run serve`.
app.use("/assets/*", serveStatic({ root: "./public" }));

// Health check — handy for "is the server up?" and for n8n to ping.
app.get("/health", (c) => c.json({ name: "DlíFios API", status: "ok" }));

// The star: ask a question, get a grounded, article-cited answer.
app.post("/ask", async (c) => {
  // Read the JSON body the client sent. Wrapped in try/catch because a
  // malformed body would otherwise throw before we can return a clean error.
  let body: { question?: string; k?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Body must be valid JSON" }, 400);
  }

  // Validate input — never trust the caller. 400 = "your request was bad".
  if (!body.question || typeof body.question !== "string") {
    return c.json({ error: "Field 'question' (string) is required" }, 400);
  }

  // Do the work. If retrieval or the LLM fails, return 500 rather than crashing
  // the whole server.
  try {
    const { answer, sources } = await ask(body.question, body.k ?? 5);
    return c.json({ question: body.question, answer, sources });
  } catch (err) {
    console.error("/ask failed:", err);
    return c.json({ error: "Failed to answer question" }, 500);
  }
});

// Ingest an act into Qdrant. Day 11's n8n daily monitor POSTs { celex, source }
// for each new act SPARQL detects, ADDING it to the corpus. With no celex it
// falls back to a clean GDPR rebuild (the base corpus / model-swap path).
app.post("/ingest", async (c) => {
  // Body is optional here, so a parse failure just means "no body" -> {}.
  let body: { celex?: string; source?: string; reset?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  try {
    if (body.celex) {
      const stored = await ingestCelex(body.celex, body.source ?? body.celex, {
        reset: body.reset ?? false,
      });
      return c.json({ stored, celex: body.celex, source: body.source ?? body.celex });
    }
    // No celex -> rebuild the base GDPR corpus.
    const stored = await ingestGdpr();
    return c.json({ stored, celex: "32016R0679", source: "GDPR" });
  } catch (err) {
    console.error("/ingest failed:", err);
    return c.json({ error: "Ingestion failed" }, 500);
  }
});

// The daily watch loop: detect new data-protection acts and ingest them.
// n8n's Cron workflow POSTs here once a day. `since` defaults to 7 days back —
// a daily run only needs a small window, with hasCelex() catching overlaps.
app.post("/monitor", async (c) => {
  let body: { since?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const since =
    body.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const result = await monitorNewActs(since);
    return c.json(result);
  } catch (err) {
    console.error("/monitor failed:", err);
    return c.json({ error: "Monitor run failed" }, 500);
  }
});

// The weekly digest: summarise the week's new acts + EDPB guidance into an
// email-ready {subject, body}. n8n's weekly Schedule POSTs here, then hands
// subject/body to a Gmail node. `since` defaults to 7 days back.
app.post("/digest", async (c) => {
  let body: { since?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const since =
    body.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const digest = await buildDigest(since);
    return c.json(digest);
  } catch (err) {
    console.error("/digest failed:", err);
    return c.json({ error: "Digest generation failed" }, 500);
  }
});

// Start listening. @hono/node-server bridges Hono's web-standard `fetch`
// handler to Node's HTTP server. The callback fires once we're live.
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`DlíFios API listening on http://localhost:${info.port}`);
});
