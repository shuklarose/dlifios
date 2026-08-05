import { useEffect, useState, type FormEvent } from "react";
import type { Auth } from "../lib/useSession";

interface Props {
  auth: Auth;
  open: boolean;
  onClose: () => void;
}

const SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"];
const SECTORS = [
  "Email marketing / Martech",
  "Legal & compliance",
  "SaaS / Technology",
  "Finance",
  "Healthcare",
  "Public sector",
  "Other",
];

export default function AuthDialog({ auth, open, onClose }: Props) {
  const [step, setStep] = useState<"form" | "code">("form");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  // Reopening always lands on the form, never a stale code step.
  useEffect(() => {
    if (!open) return;
    setStep("form");
    setCode("");
    setMessage(null);

    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("modal-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("modal-open");
    };
  }, [open, onClose]);

  // signInWithOtp both creates an unknown account and signs in a known one. The
  // fields ride along in user metadata, where the signup trigger copies them
  // into profiles the instant the auth user exists.
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth.supabase) {
      setMessage({ text: "Sign-in is unavailable right now.", kind: "err" });
      return;
    }

    const form = new FormData(event.currentTarget);
    const address = String(form.get("email") ?? "").trim();
    if (!address) return;

    setBusy(true);
    setMessage(null);
    const { error } = await auth.supabase.auth.signInWithOtp({
      email: address,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: String(form.get("full_name") ?? "").trim(),
          org: String(form.get("org") ?? "").trim() || null,
          employee_count: String(form.get("employee_count") ?? "") || null,
          sector: String(form.get("sector") ?? "") || null,
          phone: String(form.get("phone") ?? "").trim() || null,
          // An unchecked box is absent from FormData, so this is false unless
          // the user actually ticked it.
          digest_opt_in: form.get("digest_opt_in") === "on",
        },
      },
    });
    setBusy(false);

    if (error) {
      setMessage({ text: error.message, kind: "err" });
      return;
    }
    // The email carries a code as well as a link, and the code is the reliable
    // path: mail providers prefetch links to scan them, and the token is single
    // use, so it can be spent before the recipient ever clicks.
    setEmail(address);
    setStep("code");
    setMessage({ text: `Check ${address} and enter the 6-digit code below. Expires in 1 hour.`, kind: "ok" });
  }

  async function onVerify() {
    if (!auth.supabase) return;
    const token = code.replace(/\D/g, "");
    if (token.length < 6) {
      setMessage({ text: "Enter the 6-digit code from the email.", kind: "err" });
      return;
    }
    setBusy(true);
    const { error } = await auth.supabase.auth.verifyOtp({ email, token, type: "email" });
    setBusy(false);
    if (error) setMessage({ text: error.message, kind: "err" });
    // On success the session listener closes this dialog and repaints the nav.
  }

  return (
    <div
      className={`auth-wrap${open ? " open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="authTitle"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="auth-card">
        <div className="auth-head">
          <div>
            <h3 id="authTitle">Create your account</h3>
            <p>No password. We email you a secure sign-in code.</p>
          </div>
          <button className="auth-x" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>

        {step === "form" ? (
          <form className="auth-form" onSubmit={onSubmit}>
            <div className="fld">
              <label htmlFor="af-email">Work email *</label>
              <input id="af-email" name="email" type="email" required autoComplete="email" placeholder="you@company.com" />
            </div>
            <div className="fld">
              <label htmlFor="af-name">Full name *</label>
              <input id="af-name" name="full_name" type="text" required autoComplete="name" placeholder="Jane Doe" />
            </div>
            <div className="auth-row">
              <div className="fld">
                <label htmlFor="af-org">Organisation</label>
                <input id="af-org" name="org" type="text" autoComplete="organization" placeholder="Acme Ltd" />
              </div>
              <div className="fld">
                <label htmlFor="af-size">Company size</label>
                <select id="af-size" name="employee_count" defaultValue="">
                  <option value="">Select...</option>
                  {SIZES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="auth-row">
              <div className="fld">
                <label htmlFor="af-sector">Sector</label>
                <select id="af-sector" name="sector" defaultValue="">
                  <option value="">Select...</option>
                  {SECTORS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="fld">
                <label htmlFor="af-phone">Phone</label>
                <input id="af-phone" name="phone" type="tel" autoComplete="tel" placeholder="+353 ..." />
              </div>
            </div>

            {/* Unticked by default: Art. 4(11) requires a clear affirmative
                action, so a pre-ticked box would not be valid consent. */}
            <label className="auth-check">
              <input name="digest_opt_in" type="checkbox" />
              <span>
                Email me the weekly digest of new EU data-protection law. You can unsubscribe at any
                time.
              </span>
            </label>

            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? "Sending..." : "Email me a sign-in code"}
            </button>
          </form>
        ) : (
          <div className="auth-form">
            <div className="fld">
              <label htmlFor="codeInput">6-digit code from the email</label>
              <input
                id="codeInput"
                className="code-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onVerify()}
              />
            </div>
            <button className="auth-submit" type="button" disabled={busy} onClick={onVerify}>
              {busy ? "Verifying..." : "Verify and sign in"}
            </button>
            <button className="btn-cancel" type="button" onClick={() => setStep("form")}>
              Use a different email
            </button>
          </div>
        )}

        {message && <p className={`auth-msg show ${message.kind}`}>{message.text}</p>}

        {/* Art. 13 requires telling people what happens to their data where it
            is collected, not only on a page they might find later. */}
        <p className="auth-fine">
          Signing in gives you <b>20</b> questions a day. We store your name and the optional fields
          to tailor that digest, and your questions to count usage. Your question text is sent to
          Google to generate answers. Full detail in the{" "}
          <a href="/privacy" target="_blank" rel="noopener">
            privacy policy
          </a>
          ; you can delete your account and everything in it at any time.
        </p>
      </div>
    </div>
  );
}
