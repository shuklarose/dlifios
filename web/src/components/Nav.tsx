import { useEffect, useState } from "react";
import { displayName, type Auth } from "../lib/useSession";
import { fetchDigestOptIn, saveDigestOptIn } from "../lib/api";

interface Props {
  auth: Auth;
  onOpenAuth: () => void;
  onOpenDelete: () => void;
  onToast: (message: string) => void;
}

export default function Nav({ auth, onOpenAuth, onOpenDelete, onToast }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [digestOptIn, setDigestOptIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const signedIn = Boolean(auth.session);

  // Read the stored value rather than assuming, so the box reflects the
  // database instead of whatever it was last left at.
  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    auth
      .token()
      .then((t) => (t ? fetchDigestOptIn(t) : null))
      .then((value) => {
        if (active && value !== null) setDigestOptIn(value);
      })
      .catch(() => {
        // Leave it as-is. Better than showing a default that misrepresents
        // what we have recorded.
      });
    return () => {
      active = false;
    };
  }, [signedIn, auth]);

  async function toggleDigest(wanted: boolean) {
    const t = await auth.token();
    if (!t) return;
    setDigestOptIn(wanted);
    setSaving(true);
    try {
      await saveDigestOptIn(t, wanted);
      onToast(wanted ? "Subscribed to the weekly digest" : "Unsubscribed");
    } catch {
      setDigestOptIn(!wanted); // never show a preference that was not stored
      onToast("Could not save that. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <nav className="nav pad">
        <a className="brand" href="#top">
          <img
            className="brand-mark"
            src="/assets/logo.png"
            alt=""
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
          DlíFios
        </a>

        <div className="nav-links">
          <a href="#what">Features</a>
          <a href="#trust">Coverage</a>
        </div>

        <div className="nav-cta">
          {signedIn ? (
            <div className="acct">
              <span className="acct-name">{displayName(auth.session)}</span>
              {/* Consent must be as easy to withdraw as to give, so this sits
                  beside the name rather than behind a settings page. */}
              <label className={`digest-toggle${saving ? " saving" : ""}`} title="Weekly digest email">
                <input type="checkbox" checked={digestOptIn} onChange={(e) => toggleDigest(e.target.checked)} />
                <span>Digest</span>
              </label>
              <button className="btn btn-ghost" onClick={auth.signOut}>
                Sign out
              </button>
              <button className="btn btn-ghost btn-danger" onClick={onOpenDelete}>
                Delete account
              </button>
            </div>
          ) : (
            <button className="btn btn-ghost" onClick={onOpenAuth}>
              Log in
            </button>
          )}
          <a className="btn btn-primary" href="#ask">
            Try DlíFios
          </a>
        </div>

        <button
          className="hamburger"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
      </nav>

      <div className={`mobile-menu pad${menuOpen ? " open" : ""}`}>
        <a href="#what" onClick={() => setMenuOpen(false)}>Features</a>
        <a href="#trust" onClick={() => setMenuOpen(false)}>Coverage</a>
        <div className="mm-cta">
          {!signedIn && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setMenuOpen(false);
                onOpenAuth();
              }}
            >
              Log in
            </button>
          )}
          <a className="btn btn-primary" href="#ask" onClick={() => setMenuOpen(false)}>
            Try DlíFios
          </a>
        </div>
      </div>
    </>
  );
}
