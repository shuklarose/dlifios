// quota.ts — "who is asking, and are they allowed to?" (product phase 1)
//
// Two server-side jobs, both wired into /ask:
//   1. identify the caller from their Supabase session token (or treat as anonymous)
//   2. enforce a per-user daily cap BEFORE we spend a paid Gemini call, and log
//      every question to question_log (the wallet guard + Day-14 eval dataset).
//
// Why this lives on the SERVER: the browser's "2 free questions" popup is a
// conversion nudge and is bypassable (incognito wipes localStorage). Only a check
// the client CANNOT skip protects the Gemini bill. This module is that check.

import { supabaseAdmin } from "./supabase.ts";

// Signed-up users get this many questions per rolling 24h. Generous for genuine
// use, but a hard ceiling so a bug or a bad actor can't run the bill away.
// One number, one place to change it.
export const DAILY_LIMIT = 20;

// Anonymous visitors get a much smaller taste before we ask them to sign up.
// This is the conversion lever AND the wallet guard: without it, anyone could
// hammer /ask forever and every question costs us a Gemini call.
//
// Overridable via .env because the cap is per-IP, and during local development
// EVERYTHING shares one IP — a curl test from the terminal spends the same
// budget as the browser. Set ANON_LIMIT=100 in .env while demoing.
//
// Known limitation of per-IP limiting generally: an office behind a single NAT
// gateway shares one budget, so ten colleagues get three questions between them.
// Signed-in users are counted per account, which is why signup is the real fix.
export const ANON_LIMIT = Number(process.env.ANON_LIMIT ?? 3);

export interface Caller {
  id: string | null; // Supabase auth user id, or null when anonymous
  email: string | null;
}

// Turn an "Authorization: Bearer <token>" header into a verified user.
// The token is the JWT access-token the browser holds after a magic-link login.
// getUser() hands it to Supabase Auth, which checks the signature + expiry and
// returns the user. We NEVER trust a user id the client sends us directly — we
// only trust one Supabase itself vouches for. A missing/expired/forged token
// simply falls through to anonymous.
export async function identifyCaller(authHeader?: string): Promise<Caller> {
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) return { id: null, email: null };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return { id: null, email: null };
  return { id: data.user.id, email: data.user.email ?? null };
}

// How many questions has this user asked in the last 24h? Uses the same
// count-only "head" trick as the db:check — we want the number, not the rows.
async function usedInLast24h(userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabaseAdmin
    .from("question_log")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (error) throw error;
  return count ?? 0;
}

export interface QuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
}

// --- Anonymous rate limiting (in-memory) ------------------------------------
// Signed-up users are counted in Postgres because we need that history for the
// Day-14 eval set. Anonymous hits don't deserve a database round-trip, so we
// keep them in a plain Map: IP address -> the timestamps of its recent asks.
//
// Honest trade-off: this lives in the server's memory, so it resets on restart
// and wouldn't be shared across multiple server instances. For a single box
// that's fine, and it's a real cap where before there was none. If we ever run
// more than one instance, this moves to Redis or the question_log table.
const anonHits = new Map<string, number[]>();
const ANON_WINDOW_MS = 24 * 60 * 60 * 1000;

function anonUsed(ip: string): number {
  const cutoff = Date.now() - ANON_WINDOW_MS;
  // Drop anything older than the window, then keep what's left.
  const recent = (anonHits.get(ip) ?? []).filter((t) => t > cutoff);
  if (recent.length) anonHits.set(ip, recent);
  else anonHits.delete(ip); // don't let the Map grow forever with dead IPs
  return recent.length;
}

// Called only when we actually let an anonymous request through.
export function recordAnonHit(ip: string): void {
  const recent = anonHits.get(ip) ?? [];
  recent.push(Date.now());
  anonHits.set(ip, recent);
}

// The gate. Two paths:
//   signed in  -> counted in Postgres, DAILY_LIMIT per rolling 24h
//   anonymous  -> counted in memory by IP, ANON_LIMIT per rolling 24h
// Either way the caller cannot skip it, because it runs on the server.
export async function checkQuota(caller: Caller, ip?: string): Promise<QuotaResult> {
  if (!caller.id) {
    // No IP means we can't identify them at all — fail closed to one question
    // rather than handing out an unlimited free pass.
    if (!ip) return { allowed: false, used: ANON_LIMIT, limit: ANON_LIMIT };
    const used = anonUsed(ip);
    return { allowed: used < ANON_LIMIT, used, limit: ANON_LIMIT };
  }
  const used = await usedInLast24h(caller.id);
  return { allowed: used < DAILY_LIMIT, used, limit: DAILY_LIMIT };
}

// A signed-in user's recent questions, newest first.
//
// We've been writing every question to question_log since the quota gate
// shipped — this just reads it back, which is why "History" costs one query
// rather than a new feature. Anonymous callers get nothing: their rows have
// user_id = null and belong to no one in particular.
export async function recentQuestions(userId: string, limit = 20): Promise<
  { question: string; created_at: string }[]
> {
  const { data, error } = await supabaseAdmin
    .from("question_log")
    .select("question, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// Record the question. user_id is null for anonymous — the schema allows it, so
// we still capture anonymous questions for the eval dataset.
export async function logQuestion(caller: Caller, question: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("question_log")
    .insert({ user_id: caller.id, question });
  if (error) throw error;
}
