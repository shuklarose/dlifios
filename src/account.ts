// account.ts — the right to erasure (GDPR Article 17), implemented.
//
// A tool that answers questions about data-protection law has no business
// collecting names, emails and phone numbers with no way to get them back out.
// Article 17 gives a data subject the right to have their personal data erased
// without undue delay; Article 12(3) says respond within a month. A self-serve
// button is the honest version of that.
//
// This is deliberately a HARD delete, not a "deleted" flag. A soft delete still
// holds the data, which is the thing the person asked you to stop doing.

import { supabaseAdmin } from "./supabase.ts";

export interface DeletionReport {
  questionsDeleted: number;
  profileDeleted: boolean;
}

// Erase everything we hold about one user.
//
// Order matters. We delete the owned rows FIRST, while we can still identify
// them by user_id, and remove the auth user LAST. Doing it the other way round
// would trip question_log's `on delete set null`, orphaning the rows with a
// null user_id — at which point they're unattributable and we could never find
// them again to delete them. That would leave the user's questions on our disk
// forever, which is exactly the outcome erasure is supposed to prevent.
export async function deleteAccount(userId: string): Promise<DeletionReport> {
  // 1. The questions. Their text is user-authored and can easily contain
  //    personal data ("can my company process X for employee Y?"), so it is in
  //    scope for erasure — we don't get to keep it just because it's useful
  //    training material.
  const { data: removed, error: qErr } = await supabaseAdmin
    .from("question_log")
    .delete()
    .eq("user_id", userId)
    .select("id"); // returns the deleted rows so we can report a real count
  if (qErr) throw qErr;

  // 2. The profile — name, org, sector, phone, email.
  const { error: pErr } = await supabaseAdmin.from("profiles").delete().eq("id", userId);
  if (pErr) throw pErr;

  // 3. The auth user itself. Until this goes, the person still has a login and
  //    their email address still sits in auth.users. This also invalidates
  //    their session, so the token they just used stops working.
  const { error: uErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (uErr) throw uErr;

  return { questionsDeleted: removed?.length ?? 0, profileDeleted: true };
}
