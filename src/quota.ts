// Caller identification and spend limits for /ask.
//
// These run server-side because a client-side limit is a suggestion: incognito
// clears localStorage. Only a check the caller cannot skip protects the bill.

import { supabaseAdmin } from "./supabase.ts";

// Per rolling 24h, per account.
export const DAILY_LIMIT = 20;

// Per rolling 24h, per IP. Env-overridable because local development shares one
// IP between the browser and any curl testing.
//
// Per-IP limiting cannot tell people apart, only network locations: an office
// behind one NAT gateway shares a single budget. Accounts are the real fix.
export const ANON_LIMIT = Number(process.env.ANON_LIMIT ?? 3);

export interface Caller {
  id: string | null; // Supabase auth user id, or null when anonymous
  email: string | null;
}

// Verifies the bearer token with Supabase and returns who it belongs to. A user
// id supplied by the client is never trusted; only one Supabase vouches for.
// Missing, expired or forged tokens fall through to anonymous.
export async function identifyCaller(authHeader?: string): Promise<Caller> {
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) return { id: null, email: null };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return { id: null, email: null };
  return { id: data.user.id, email: data.user.email ?? null };
}

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

// Anonymous hits are tracked in memory rather than Postgres: no round-trip, and
// nothing worth persisting. IP -> timestamps of recent requests.
//
// This resets on restart and is not shared across instances, so it holds only
// for a single server. Multiple instances would need Redis.
const anonHits = new Map<string, number[]>();
const ANON_WINDOW_MS = 24 * 60 * 60 * 1000;

function anonUsed(ip: string): number {
  const cutoff = Date.now() - ANON_WINDOW_MS;
  const recent = (anonHits.get(ip) ?? []).filter((t) => t > cutoff);
  // Dropping empty entries keeps the Map from growing without bound.
  if (recent.length) anonHits.set(ip, recent);
  else anonHits.delete(ip);
  return recent.length;
}

export function recordAnonHit(ip: string): void {
  const recent = anonHits.get(ip) ?? [];
  recent.push(Date.now());
  anonHits.set(ip, recent);
}

// Signed in: counted in Postgres. Anonymous: counted in memory by IP.
export async function checkQuota(caller: Caller, ip?: string): Promise<QuotaResult> {
  if (!caller.id) {
    // No IP means no way to count them, so deny rather than grant a free pass.
    if (!ip) return { allowed: false, used: ANON_LIMIT, limit: ANON_LIMIT };
    const used = anonUsed(ip);
    return { allowed: used < ANON_LIMIT, used, limit: ANON_LIMIT };
  }
  const used = await usedInLast24h(caller.id);
  return { allowed: used < DAILY_LIMIT, used, limit: DAILY_LIMIT };
}

// Recent questions for one user, newest first. Anonymous rows have a null
// user_id and belong to nobody, so they are never returned.
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

// user_id is null for anonymous callers, which the schema allows.
export async function logQuestion(caller: Caller, question: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("question_log")
    .insert({ user_id: caller.id, question });
  if (error) throw error;
}
