// HTTP API and UI. Browser routes are session-authenticated; /ingest, /monitor
// and /digest are machine routes called by n8n and gated by ADMIN_TOKEN.

import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

import { ask } from "./answer.ts";
import { ingestCelex, ingestGdpr } from "./store.ts";
import { monitorNewActs } from "./monitor.ts";
import { buildDigest } from "./digest.ts";
import { deleteAccount } from "./account.ts";
import {
  identifyCaller,
  checkQuota,
  logQuestion,
  recordAnonHit,
  recentQuestions,
  digestRecipients,
  getDigestOptIn,
  setDigestOptIn,
  DAILY_LIMIT,
  ANON_LIMIT,
} from "./quota.ts";

const app = new Hono();

// The UI can be served from this process (one origin, no CORS) or hosted
// separately, in which case the browser sends cross-origin requests here and
// needs an explicit allow.
//
// An allowlist rather than "*": these routes carry an Authorization header, and
// a wildcard origin would let any site on the internet make authenticated calls
// with a user's token. Empty by default, so the same-origin setup stays closed.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin");
  const allowed = origin && ALLOWED_ORIGINS.includes(origin);

  if (allowed) {
    c.header("Access-Control-Allow-Origin", origin);
    // Tells caches the response varies by Origin, so one origin's response is
    // never replayed to another.
    c.header("Vary", "Origin");
    c.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    c.header("Access-Control-Max-Age", "86400");
  }

  // Preflight: answer before the route runs, and only for allowed origins.
  if (c.req.method === "OPTIONS") {
    return c.body(null, allowed ? 204 : 403);
  }

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
      // The browser talks to Supabase Auth directly.
      "connect-src 'self' https://*.supabase.co https://esm.sh",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );
});

// UI is served from the same origin as the API, so there is no CORS surface and
// no hardcoded API URL in the page. Paths resolve relative to this file so the
// working directory doesn't matter.
const UI_PATH = fileURLToPath(new URL("../public/index.html", import.meta.url));
const PRIVACY_PATH = fileURLToPath(new URL("../public/privacy.html", import.meta.url));

app.get("/", (c) => c.html(readFileSync(UI_PATH, "utf8")));
app.get("/privacy", (c) => c.html(readFileSync(PRIVACY_PATH, "utf8")));
app.use("/assets/*", serveStatic({ root: "./public" }));
app.get("/health", (c) => c.json({ name: "DlíFios API", status: "ok" }));

// The anon key is public by design: it grants only what RLS policies allow. The
// service-role key, which bypasses RLS, is never sent here. Serving config from
// .env rather than hardcoding it keeps deploys to a new domain config-only.
app.get("/config", (c) =>
  c.json({
    supabaseUrl: process.env.SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "",
    dailyLimit: DAILY_LIMIT,
    anonLimit: ANON_LIMIT,
  }),
);

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
const MAX_QUESTION_LENGTH = 1000;

// Gate for the machine routes. /ingest re-embeds the corpus and with reset:true
// drops it first; /digest spends model calls. Unauthenticated, those are a
// corpus-destruction and billing vector.
//
// Fails closed: an unset ADMIN_TOKEN denies rather than allows.
function adminOk(c: Context): boolean {
  if (!ADMIN_TOKEN) return false;

  const supplied = Buffer.from((c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(ADMIN_TOKEN);

  // timingSafeEqual throws on length mismatch, so check that first. Length is
  // not the secret; the bytes are.
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

// A signed-in user's own question history. Requires a valid token: without one
// there's no user to scope the query to, so we refuse rather than guess.
// 401 = "you aren't authenticated", which is different from 403 "you are, but
// you're not allowed" - the browser uses that difference to prompt a login.
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

// Read and change the caller's digest preference. Consent has to be as easy to
// withdraw as it was to give (Art. 7(3)), and until this existed it could only
// be given, at signup, and never taken back.
app.get("/preferences", async (c) => {
  const caller = await identifyCaller(c.req.header("Authorization"));
  if (!caller.id) return c.json({ error: "Sign in first" }, 401);

  try {
    return c.json({ digestOptIn: await getDigestOptIn(caller.id) });
  } catch (err) {
    console.error("/preferences read failed:", err);
    return c.json({ error: "Could not load preferences" }, 500);
  }
});

app.post("/preferences", async (c) => {
  const caller = await identifyCaller(c.req.header("Authorization"));
  if (!caller.id) return c.json({ error: "Sign in first" }, 401);

  let body: { digestOptIn?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Body must be valid JSON" }, 400);
  }
  // Only a real boolean counts. A truthy string would let "false" opt someone in.
  if (typeof body.digestOptIn !== "boolean") {
    return c.json({ error: "Field 'digestOptIn' (boolean) is required" }, 400);
  }

  try {
    await setDigestOptIn(caller.id, body.digestOptIn);
    return c.json({ digestOptIn: body.digestOptIn });
  } catch (err) {
    console.error("/preferences write failed:", err);
    return c.json({ error: "Could not save preferences" }, 500);
  }
});

// GDPR Art. 17 erasure. Scoped to the token holder: no user id parameter exists,
// so this cannot be aimed at another account. The confirm field keeps an
// irreversible action out of reach of a stray fetch.
app.delete("/account", async (c) => {
  const caller = await identifyCaller(c.req.header("Authorization"));
  if (!caller.id) return c.json({ error: "Sign in first" }, 401);

  let body: { confirm?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (body.confirm !== "DELETE") {
    return c.json({ error: 'Send {"confirm":"DELETE"} to confirm' }, 400);
  }

  try {
    const report = await deleteAccount(caller.id);
    return c.json({ deleted: true, ...report });
  } catch (err) {
    console.error("/account delete failed:", err);
    return c.json({ error: "Could not delete account" }, 500);
  }
});

app.post("/ask", async (c) => {
  let body: { question?: string; k?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Body must be valid JSON" }, 400);
  }

  // Server-side validation is the only validation that counts; the browser's is
  // a courtesy to honest users. Anyone can curl this endpoint.
  if (!body.question || typeof body.question !== "string") {
    return c.json({ error: "Field 'question' (string) is required" }, 400);
  }

  const question = body.question.trim();
  if (!question) {
    return c.json({ error: "Field 'question' cannot be empty" }, 400);
  }

  // Both caps are billing controls. Unbounded, a single request could carry
  // megabytes into the prompt, and k=10000 would retrieve 10000 chunks and
  // include every one. We reject rather than clamp so a buggy caller finds out.
  if (question.length > MAX_QUESTION_LENGTH) {
    return c.json({ error: `Question is too long (max ${MAX_QUESTION_LENGTH} characters)` }, 400);
  }

  let k = 5;
  if (body.k !== undefined) {
    if (typeof body.k !== "number" || !Number.isInteger(body.k) || body.k < 1 || body.k > 20) {
      return c.json({ error: "Field 'k' must be an integer between 1 and 20" }, 400);
    }
    k = body.k;
  }

  // Behind a proxy the client IP is the first entry in x-forwarded-for; fall
  // back to the socket address for direct connections.
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
    c.req.header("x-real-ip") ||
    (c.env as any)?.incoming?.socket?.remoteAddress ||
    "";

  let caller;
  let used = 0;
  let limit = DAILY_LIMIT;
  try {
    caller = await identifyCaller(c.req.header("Authorization"));
    const quota = await checkQuota(caller, ip);
    limit = quota.limit;
    if (!quota.allowed) {
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
    // Counted before the model call: once we are about to spend, it counts,
    // even if generation later fails.
    await logQuestion(caller, question);
    if (!caller.id && ip) recordAnonHit(ip);
    used = quota.used + 1;
  } catch (err) {
    console.error("/ask quota check failed:", err);
    return c.json({ error: "Could not verify request quota" }, 500);
  }

  try {
    const { answer, sources } = await ask(question, k);
    // Quota echoed back so the UI can render remaining questions without a
    // second round-trip.
    return c.json({
      question,
      answer,
      sources,
      signedIn: Boolean(caller.id),
      used,
      limit,
    });
  } catch (err) {
    console.error("/ask failed:", err);

    // The model provider's own rate limit, which is not the caller's fault and
    // not a bug. Passing it through as a generic 500 sent people looking for a
    // broken deployment when the real answer is "try again shortly".
    if (isUpstreamRateLimit(err)) {
      return c.json(
        {
          error:
            "The language model is rate limited right now. This is an upstream " +
            "limit, not a problem with your question. Please try again shortly.",
          upstream: true,
        },
        503,
      );
    }
    return c.json({ error: "Failed to answer question" }, 500);
  }
});

// Provider errors arrive wrapped by the SDK, so check the status field the
// LangChain wrapper preserves and fall back to matching the message.
function isUpstreamRateLimit(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /429|too many requests|quota|rate.?limit/i.test(message);
}

// Adds one act to the corpus. Called per act by the monitor. With no celex it
// rebuilds the GDPR base corpus, which is the path used after a model swap.
app.post("/ingest", async (c) => {
  if (!adminOk(c)) return c.json({ error: "Unauthorized" }, 401);

  // Body is optional here.
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
    const stored = await ingestGdpr();
    return c.json({ stored, celex: "32016R0679", source: "GDPR" });
  } catch (err) {
    console.error("/ingest failed:", err);
    return c.json({ error: "Ingestion failed" }, 500);
  }
});

// Discovers newly published data-protection acts and ingests them. Run daily by
// n8n. The 7-day default window overlaps deliberately; hasCelex() dedupes.
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

// Summarises the week's new acts and EDPB guidance into {subject, body} for the
// weekly email. Run by n8n, which passes the result to a Gmail node.
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
    // Recipients travel with the digest so n8n needs one call, and the list is
    // read fresh each run: an unsubscribe takes effect on the next send.
    const [digest, recipients] = await Promise.all([buildDigest(since), digestRecipients()]);
    return c.json({ ...digest, recipients });
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
