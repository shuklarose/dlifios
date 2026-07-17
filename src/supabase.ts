// supabase.ts — the server-side Supabase client (product phase 1).
//
// This is the ADMIN connection to our database + auth. It authenticates with the
// service_role key, which BYPASSES Row Level Security entirely. That is exactly
// what a trusted backend wants: our API needs to write question_log rows and
// count them across ALL users to enforce the quota — the very things RLS
// deliberately forbids the browser from doing.
//
// The browser will get its OWN, separate client built with the ANON key (later,
// in the frontend), where RLS is fully in force. This service_role key must
// never be shipped to the browser — it lives only here, on the server.

import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

// Load SUPABASE_* from .env into process.env (Node built-in) — same one-liner
// every other module in this project uses.
process.loadEnvFile();

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Fail loud and early with a readable message. Without this guard a missing key
// surfaces much later as an opaque "Invalid API key" from deep inside supabase-js.
if (!url || !serviceRoleKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env — see .env.example",
  );
}

// One client for the whole process. A module-level const IS a singleton in ESM:
// the module body runs once, and every file that imports this shares the instance.
export const supabaseAdmin = createClient(url, serviceRoleKey, {
  auth: {
    // This is a stateless server, not a browser. Turn off the browser-oriented
    // session machinery: there is no localStorage to persist a session to, and no
    // logged-in user whose token we'd auto-refresh. Skipping it avoids needless
    // work (and noisy warnings) in Node.
    persistSession: false,
    autoRefreshToken: false,
  },
});

// --- self-test: `npm run db:check` ------------------------------------------
// Proves three things at once: the service_role key works, the network reaches
// Supabase, and schema.sql actually created the tables. `head: true` asks for the
// row COUNT only (no data), so it's a cheap ping.
async function demo() {
  const { count, error } = await supabaseAdmin
    .from("question_log")
    .select("*", { count: "exact", head: true });

  if (error) {
    console.error("❌ Supabase check failed:", error.message);
    process.exit(1);
  }
  console.log(`✅ Connected to Supabase. question_log has ${count} rows.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  demo();
}
