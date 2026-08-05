// Empty base means same origin, which is the case behind the dev proxy and
// whenever the Node server serves the built files. Set VITE_API_BASE when the
// frontend is hosted separately, and add that origin to ALLOWED_ORIGINS.
const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
export const api = (path: string) => API_BASE + path;

export interface Source {
  label: string;
  act: string;
  article: string;
  celex: string;
  url: string;
  excerpt: string;
}

export interface AskResult {
  question: string;
  answer: string;
  sources: Source[];
  signedIn: boolean;
  used: number;
  limit: number;
  error?: string;
  upstream?: boolean;
}

export interface PublicConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  dailyLimit: number;
  anonLimit: number;
}

export async function fetchConfig(): Promise<PublicConfig> {
  const res = await fetch(api("/config"));
  if (!res.ok) throw new Error("config unavailable");
  return res.json();
}

// Returns the body whatever the status. The caller distinguishes three cases:
// the caller's own quota, the model provider's rate limit, and everything else.
export async function ask(question: string, token: string | null) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(api("/ask"), {
    method: "POST",
    headers,
    body: JSON.stringify({ question }),
  });
  return { status: res.status, data: (await res.json()) as AskResult };
}

export interface HistoryEntry {
  question: string;
  created_at: string;
}

export async function fetchHistory(token: string): Promise<HistoryEntry[]> {
  const res = await fetch(api("/history"), { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Could not load history");
  return data.questions;
}

export async function fetchDigestOptIn(token: string): Promise<boolean> {
  const res = await fetch(api("/preferences"), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Could not load preferences");
  return (await res.json()).digestOptIn;
}

export async function saveDigestOptIn(token: string, digestOptIn: boolean): Promise<void> {
  const res = await fetch(api("/preferences"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ digestOptIn }),
  });
  if (!res.ok) throw new Error("Could not save preferences");
}

export async function deleteAccount(token: string): Promise<{ questionsDeleted: number }> {
  const res = await fetch(api("/account"), {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ confirm: "DELETE" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Could not delete account");
  return data;
}
