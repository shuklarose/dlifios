import { useCallback, useEffect, useState } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { fetchConfig, type PublicConfig } from "./api";

export interface Auth {
  supabase: SupabaseClient | null;
  config: PublicConfig | null;
  session: Session | null;
  failed: boolean;
  token: () => Promise<string | null>;
  signOut: () => Promise<void>;
  clearSession: () => void;
}

export function displayName(session: Session | null): string {
  if (!session) return "";
  const meta = session.user.user_metadata as { full_name?: string } | undefined;
  return meta?.full_name || session.user.email || "";
}

// The client is built from values the API serves at runtime rather than from
// build-time env vars, so one bundle works against any deployment. The anon key
// is public by design: it grants only what Row Level Security allows.
export function useSession(): Auth {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    fetchConfig()
      .then(async (cfg) => {
        if (!active) return;
        if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error("not configured");

        const client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
        setSupabase(client);
        setConfig(cfg);

        // Ask explicitly as well as subscribing, so the first render is right
        // rather than waiting for the initial event.
        const { data } = await client.auth.getSession();
        if (!active) return;
        setSession(data.session);

        const { data: sub } = client.auth.onAuthStateChange((_event, next) => {
          setSession(next);
          // A magic link leaves #access_token in the address bar. Strip it so a
          // copied URL never carries a live token.
          if (next && window.location.hash.includes("access_token")) {
            window.history.replaceState(null, "", window.location.pathname + window.location.search);
          }
        });
        unsubscribe = () => sub.subscription.unsubscribe();
      })
      .catch(() => active && setFailed(true));

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  // Read the live token rather than caching one, so a silently refreshed token
  // is the one that gets sent.
  const token = useCallback(async () => {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, [supabase]);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    setSession(null);
  }, [supabase]);

  // After deletion the server-side user is gone, so drop the local session
  // rather than signing out through a client whose user no longer exists.
  const clearSession = useCallback(() => setSession(null), []);

  return { supabase, config, session, failed, token, signOut, clearSession };
}
