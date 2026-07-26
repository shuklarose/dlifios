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
import {
  identifyCaller,
  checkQuota,
  logQuestion,
  recordAnonHit,
  recentQuestions,
  DAILY_LIMIT,
  ANON_LIMIT,
} from "./quota.ts";

// A Hono app is just a collection of routes. Each handler gets a "context" `c`
// holding the request and helpers to build the response (c.json, c.req, etc.).
const app = new Hono();

// Security headers on every response. Each one closes a specific attack:
//
//   nosniff          browsers must trust our declared Content-Type instead of
//                    guessing — stops an uploaded "image" being run as script.
//   frame-ancestors  nobody can iframe us, which kills clickjacking (an
//                    invisible DlíFios layered under an attacker's buttons).
//   referrer-policy  our URLs stop leaking to sites the user clicks through to.
//   HSTS             after the first visit the browser refuses plain HTTP,
//                    so a network attacker can't downgrade the connection.
//   CSP              the big one: scripts may only come from this origin and
//                    the one CDN we load supabase-js from. If someone ever
//                    injects a <script src="evil.com">, the browser blocks it.
//
// 'unsafe-inline' is present because the page's CSS and JS are inline in
// index.html. That's a real weakening — the honest fix is moving them to
// separate files and dropping it, which is a refactor, not a one-liner.
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://esm.sh",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      // The browser talks directly to Supabase Auth, so it must be allowed.
      "connect-src 'self' https://*.supabase.co https://esm.sh",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );
});

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

// Public browser config. The page needs two values to talk to Supabase Auth:
// the project URL and the ANON key. Both are public BY DESIGN — the anon key
// only grants what Row Level Security allows, which is why we spent the effort
// writing RLS policies. The SERVICE ROLE key is never sent here; it stays on the
// server where it belongs.
//
// Why an endpoint instead of hardcoding them in index.html? Config lives in .env
// in exactly one place, so deploying to a real domain (or a second environment)
// means changing .env — never editing HTML.
app.get("/config", (c) =>
  c.json({
    supabaseUrl: process.env.SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "",
    dailyLimit: DAILY_LIMIT,
    anonLimit: ANON_LIMIT,
  }),
);

// --- Machine-endpoint guard -------------------------------------------------
// /ingest, /monitor and /digest are called by n8n, never by a browser. They are
// also the expensive ones: ingest re-embeds the whole corpus (and with
// reset:true DELETES it first), digest spends Gemini calls. Left open, anyone
// who learns the URL can drain the API key or destroy the vector store.
//
// So they require a shared secret from .env. This is deliberately NOT Supabase
// auth: the caller is a machine with no user account, and a long random string
// in n8n's credential store is the right shape for that.
//
// Fails CLOSED — if ADMIN_TOKEN isn't configured, the endpoints refuse rather
// than silently allowing everything. A missing config should never mean "open".
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

function adminOk(c: any): boolean {
  if (!ADMIN_TOKEN) return false;
  const supplied = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  // Compare full length rather than bailing on the first wrong character, so
  // response time doesn't leak how much of the token an attacker guessed right.
  if (supplied.length !== ADMIN_TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < ADMIN_TOKEN.length; i++) diff |= supplied.charCodeAt(i) ^ ADMIN_TOKEN.charCodeAt(i);
  return diff === 0;
}

// A signed-in user's own question history. Requires a valid token: without one
// there's no user to scope the query to, so we refuse rather than guess.
// 401 = "you aren't authenticated", which is different from 403 "you are, but
// you're not allowed" — the browser uses that difference to prompt a login.
app.get("/history", async (c) => {
  const caller = await identifyCaller(c.req.header("Authorization"));
  if (!caller.id) return c.json({ error: "Sign in to see your history" }, 401);

  try {
    const questions = await recentQuestions(caller.id);
    return c.json({ questions });
  } catch (err) {
    console.error("/history failed:", err);
    return c.json({ error: "Could not load history" }, 500);
  }
});

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

  // --- The quota gate (product phase 1) -------------------------------------
  // Identify the caller from their Supabase login token (anonymous if none),
  // then refuse BEFORE spending a paid Gemini call if a signed-up user is over
  // their daily cap. 429 = "Too Many Requests". Anonymous callers pass through
  // for now (the public UI is anonymous-only until login ships); their IP-based
  // cap is the next step.
  //
  // NOTE: anonymous /ask currently has no server-side spend cap — closing that
  // (IP-based) is tracked as the follow-up before this is publicly deployed.
  // Who is this, by IP? Behind a proxy (nginx, Cloudflare) the real client IP
  // arrives in x-forwarded-for as "client, proxy1, proxy2" — the first entry is
  // the one we want. Falls back to the socket address for direct connections.
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
    c.req.header("x-real-ip") ||
    c.env?.incoming?.socket?.remoteAddress ||
    "";

  let caller;
  let used = 0; // questions this caller has spent today, AFTER counting this one
  let limit = DAILY_LIMIT;
  try {
    caller = await identifyCaller(c.req.header("Authorization"));
    const quota = await checkQuota(caller, ip);
    limit = quota.limit;
    if (!quota.allowed) {
      // Two different walls, two different messages. An anonymous visitor who
      // hits the wall should be told signing up fixes it — that's the funnel.
      return c.json(
        {
          error: caller.id
            ? `Daily limit of ${quota.limit} questions reached. Try again tomorrow.`
            : `You've used your ${quota.limit} free questions. Sign up free for ${DAILY_LIMIT} a day.`,
          signedIn: Boolean(caller.id),
          used: quota.used,
          limit: quota.limit,
        },
        429,
      );
    }
    // Count it BEFORE the LLM call: the moment we're about to spend money, the
    // question counts against quota — even if the answer step later fails.
    await logQuestion(caller, body.question);
    if (!caller.id && ip) recordAnonHit(ip);
    used = quota.used + 1; // +1 for the one we just counted
  } catch (err) {
    console.error("/ask quota check failed:", err);
    return c.json({ error: "Could not verify request quota" }, 500);
  }

  // Do the work. If retrieval or the LLM fails, return 500 rather than crashing
  // the whole server.
  try {
    const { answer, sources } = await ask(body.question, body.k ?? 5);
    // Echo the quota back so the UI can show "3 of 20 used today" without a
    // second round-trip. signedIn tells the page whether that number is real.
    return c.json({
      question: body.question,
      answer,
      sources,
      signedIn: Boolean(caller.id),
      used,
      limit,
    });
  } catch (err) {
    console.error("/ask failed:", err);
    return c.json({ error: "Failed to answer question" }, 500);
  }
});

// Ingest an act into Qdrant. Day 11's n8n daily monitor POSTs { celex, source }
// for each new act SPARQL detects, ADDING it to the corpus. With no celex it
// falls back to a clean GDPR rebuild (the base corpus / model-swap path).
app.post("/ingest", async (c) => {
  if (!adminOk(c)) return c.json({ error: "Unauthorized" }, 401);

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
  if (!adminOk(c)) return c.json({ error: "Unauthorized" }, 401);

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
  if (!adminOk(c)) return c.json({ error: "Unauthorized" }, 401);

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
