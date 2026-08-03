// Server-side Supabase client, authenticated with the service_role key.
//
// service_role bypasses Row Level Security, which is what a trusted backend
// needs: counting question_log rows across all users is exactly what RLS forbids
// the browser from doing. This key must never reach the browser. The frontend
// builds its own client from the anon key, where RLS applies in full.

import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import "./env.ts";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Without this guard a missing key surfaces much later as an opaque
// "Invalid API key" from inside supabase-js.
if (!url || !serviceRoleKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env - see .env.example",
  );
}

export const supabaseAdmin = createClient(url, serviceRoleKey, {
  auth: {
    // No browser here: nothing to persist a session to, and no user token to refresh.
    persistSession: false,
    autoRefreshToken: false,
  },
});

// npm run db:check - proves the key works, the network reaches Supabase, and
// schema.sql ran. head: true fetches the count without the rows.
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
