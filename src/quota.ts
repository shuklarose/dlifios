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

// The gate. A signed-up user is blocked once they reach DAILY_LIMIT in 24h.
// Anonymous callers (id === null) are NOT capped here yet — the current public UI
// is anonymous-only, so an IP-based anonymous cap is the next step (see server.ts).
export async function checkQuota(caller: Caller): Promise<QuotaResult> {
  if (!caller.id) return { allowed: true, used: 0, limit: DAILY_LIMIT };
  const used = await usedInLast24h(caller.id);
  return { allowed: used < DAILY_LIMIT, used, limit: DAILY_LIMIT };
}

// Record the question. user_id is null for anonymous — the schema allows it, so
// we still capture anonymous questions for the eval dataset.
export async function logQuestion(caller: Caller, question: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("question_log")
    .insert({ user_id: caller.id, question });
  if (error) throw error;
}
