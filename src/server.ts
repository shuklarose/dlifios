// server.ts — Day 9: expose the RAG system over HTTP with Hono.
// Until now ask() and ingestGdpr() only ran from the CLI. This turns them into
// "doors" other programs can knock on: n8n (Days 10-12) and the UI (Day 13)
// will POST to these routes instead of importing our code.
//
//   POST /ask     { "question": "...", "k"?: number }  -> { answer, sources }
//   POST /ingest                                        -> { stored }
//   GET  /                                              -> health/info

import { Hono } from "hono";
import { serve } from "@hono/node-server";

import { ask } from "./answer.ts";
import { ingestGdpr } from "./store.ts";

// A Hono app is just a collection of routes. Each handler gets a "context" `c`
// holding the request and helpers to build the response (c.json, c.req, etc.).
const app = new Hono();

// Health check — handy for "is the server up?" and for n8n to ping.
app.get("/", (c) => c.json({ name: "DlíFios API", status: "ok" }));

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

// (Re)ingest the GDPR corpus into Qdrant. Day 11's n8n daily monitor will call
// this. For now it re-ingests the full GDPR; Day 11 generalises it to fetch and
// ingest whatever new act SPARQL detects.
app.post("/ingest", async (c) => {
  try {
    const stored = await ingestGdpr();
    return c.json({ stored });
  } catch (err) {
    console.error("/ingest failed:", err);
    return c.json({ error: "Ingestion failed" }, 500);
  }
});

// Start listening. @hono/node-server bridges Hono's web-standard `fetch`
// handler to Node's HTTP server. The callback fires once we're live.
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`DlíFios API listening on http://localhost:${info.port}`);
});
