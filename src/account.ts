// GDPR Article 17 erasure. Hard delete rather than a flag: a soft delete still
// holds the data, which is the thing the person asked us to stop doing.

import { supabaseAdmin } from "./supabase.ts";

export interface DeletionReport {
  questionsDeleted: number;
  profileDeleted: boolean;
}

// Order matters: owned rows first, auth user last. Reversed, deleting the auth
// user trips question_log's `on delete set null` and orphans those rows with a
// null user_id, leaving them unattributable and impossible to find again.
export async function deleteAccount(userId: string): Promise<DeletionReport> {
  // Question text is user-authored and can contain personal data, so it is in
  // scope for erasure regardless of its value as evaluation material.
  const { data: removed, error: qErr } = await supabaseAdmin
    .from("question_log")
    .delete()
    .eq("user_id", userId)
    .select("id");
  if (qErr) throw qErr;

  const { error: pErr } = await supabaseAdmin.from("profiles").delete().eq("id", userId);
  if (pErr) throw pErr;

  // Also invalidates the session, so the token used to make this call dies with it.
  const { error: uErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (uErr) throw uErr;

  return { questionsDeleted: removed?.length ?? 0, profileDeleted: true };
}
