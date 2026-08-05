import { useState } from "react";
import { ask, fetchHistory, type Source, type HistoryEntry } from "../lib/api";
import type { Auth } from "../lib/useSession";

// Every example has to be answerable from the corpus. Questions about case law
// or what changed "recently" are correctly refused, so using them here would
// land a visitor's first click on a shrug.
const EXAMPLES = [
  "What are the lawful bases for processing personal data?",
  "When is a data protection impact assessment required?",
  "What are the transparency obligations for high-risk AI systems?",
];

type Panel =
  | { kind: "empty" }
  | { kind: "loading"; question: string }
  | { kind: "answer"; question: string; answer: string; sources: Source[] }
  | { kind: "message"; question: string; text: string }
  | { kind: "history"; entries: HistoryEntry[] };

interface Props {
  auth: Auth;
  onOpenAuth: () => void;
}

// Escape first, then allow the small subset of formatting the model emits.
function renderAnswer(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^\s*[*-]\s+/gm, "• ");
}

export default function Ask({ auth, onOpenAuth }: Props) {
  const [question, setQuestion] = useState("");
  const [panel, setPanel] = useState<Panel>({ kind: "empty" });
  const [quota, setQuota] = useState<{ used: number; limit: number; signedIn: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setPanel({ kind: "loading", question: text });

    try {
      const token = await auth.token();
      const { status, data } = await ask(text, token);

      // Three distinct non-ok cases. Collapsing them into one generic error is
      // what previously made a provider outage look like a broken deployment.
      if (status === 503 && data.upstream) {
        setPanel({ kind: "message", question: text, text: data.error ?? "Temporarily unavailable" });
        return;
      }
      if (status === 429) {
        setPanel({ kind: "message", question: text, text: data.error ?? "Daily limit reached" });
        setQuota({ used: data.used, limit: data.limit, signedIn: data.signedIn });
        return;
      }
      if (status !== 200) throw new Error(data.error ?? `Request failed (${status})`);

      setPanel({ kind: "answer", question: text, answer: data.answer, sources: data.sources });
      setQuota({ used: data.used, limit: data.limit, signedIn: data.signedIn });
    } catch (err) {
      setPanel({
        kind: "message",
        question: text,
        text: err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      setBusy(false);
    }
  }

  async function showHistory() {
    const token = await auth.token();
    if (!token) {
      setPanel({ kind: "message", question: "History", text: "Sign in to keep a history of your questions." });
      return;
    }
    setPanel({ kind: "loading", question: "History" });
    try {
      setPanel({ kind: "history", entries: await fetchHistory(token) });
    } catch (err) {
      setPanel({
        kind: "message",
        question: "History",
        text: err instanceof Error ? err.message : "Could not load history",
      });
    }
  }

  const remaining = quota ? Math.max(0, quota.limit - quota.used) : null;

  return (
    <section className="section ask-section" id="ask">
      <div className="pad">
        <div className="section-head">
          <h2>Ask DlíFios</h2>
          <p>Ask in plain English. Every answer cites the article it came from.</p>
        </div>

        <div className="ask-bar">
          {/* A placeholder is not a label: it disappears on focus and screen
              readers may not announce it. */}
          <input
            type="text"
            autoComplete="off"
            aria-label="Ask a question about EU data-protection law"
            placeholder="Ask a question about GDPR or the AI Act..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit(question)}
          />
          <button className="send-btn" aria-label="Send" disabled={busy} onClick={() => submit(question)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        <div className="chips">
          {EXAMPLES.map((ex) => (
            <button
              className="chip-q"
              key={ex}
              onClick={() => {
                setQuestion(ex);
                submit(ex);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.5 9a2.5 2.5 0 1 1 3 2.5c-.7.3-1.5 1-1.5 2" />
                <circle cx="12" cy="17" r="0.5" />
              </svg>
              {ex}
            </button>
          ))}
        </div>

        {quota && remaining !== null && (
          <p className="quota-pill show">
            {quota.signedIn ? (
              <>
                <b>{remaining}</b> of {quota.limit} questions left today
              </>
            ) : (
              <>
                <b>{remaining}</b> of {quota.limit} free questions left{" "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenAuth();
                  }}
                >
                  sign up free
                </a>{" "}
                for 20 a day
              </>
            )}
          </p>
        )}

        <div className="chat-panel">
          <aside className="chat-side">
            <button
              className="side-item"
              onClick={() => {
                setQuestion("");
                setPanel({ kind: "empty" });
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New Chat
            </button>
            {/* History is a read of the usage log the quota gate already writes,
                not a separate store. */}
            <button className="side-item" onClick={showHistory}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v5h5" />
                <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
                <path d="M12 7v5l4 2" />
              </svg>
              History
            </button>
          </aside>

          <div className="chat-main">
            <PanelView
              panel={panel}
              onPick={(q) => {
                setQuestion(q);
                submit(q);
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function PanelView({ panel, onPick }: { panel: Panel; onPick: (q: string) => void }) {
  if (panel.kind === "empty") {
    return (
      <>
        <p className="ans-q">Ask a question to get started</p>
        <div className="status">
          Your answer will appear here, with links to the official EU texts it came from. Try one of
          the example questions above, or type your own.
        </div>
      </>
    );
  }

  if (panel.kind === "loading") {
    return (
      <>
        <p className="ans-q">{panel.question}</p>
        <div className="status">Searching the law and composing a cited answer...</div>
      </>
    );
  }

  if (panel.kind === "message") {
    return (
      <>
        <p className="ans-q">{panel.question}</p>
        <div className="status">{panel.text}</div>
      </>
    );
  }

  if (panel.kind === "history") {
    if (!panel.entries.length) {
      return (
        <>
          <p className="ans-q">History</p>
          <div className="status">No questions yet. Ask one and it will show up here.</div>
        </>
      );
    }
    return (
      <>
        <p className="ans-q">Your recent questions</p>
        <ul className="src-list">
          {panel.entries.map((entry, i) => (
            <li key={`${entry.created_at}-${i}`}>
              <a
                href="#ask"
                onClick={(e) => {
                  e.preventDefault();
                  onPick(entry.question);
                }}
              >
                {entry.question}
              </a>{" "}
              <span className="src-tag">{new Date(entry.created_at).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <>
      <p className="ans-q">{panel.question}</p>
      <div className="ans-body" dangerouslySetInnerHTML={{ __html: renderAnswer(panel.answer) }} />

      {panel.sources.length > 0 && (
        <div className="ans-sources">
          <h4>Sources</h4>
          <ul className="src-list">
            {panel.sources.map((s) => (
              <li key={s.label}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.label}
                </a>{" "}
                <span className="src-tag">EUR-Lex</span>
                {s.excerpt && (
                  // The claim and its evidence sit together, so a reader can
                  // check one against the other without leaving the page.
                  <details className="src-excerpt">
                    <summary>Show the text</summary>
                    <blockquote>{s.excerpt}</blockquote>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="ans-foot">
        <span className="disclaimer">Answer generated by DlíFios AI. Please verify critical information.</span>
      </div>
    </>
  );
}
