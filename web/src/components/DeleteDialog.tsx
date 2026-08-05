import { useEffect, useState } from "react";
import type { Auth } from "../lib/useSession";
import { deleteAccount } from "../lib/api";

interface Props {
  auth: Auth;
  open: boolean;
  onClose: () => void;
  onDeleted: (questionsDeleted: number) => void;
}

export default function DeleteDialog({ auth, open, onClose, onDeleted }: Props) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setConfirm("");
    setError(null);
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, [open]);

  async function onDelete() {
    const token = await auth.token();
    if (!token) return;
    setBusy(true);
    try {
      const report = await deleteAccount(token);
      auth.clearSession();
      onClose();
      onDeleted(report.questionsDeleted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`auth-wrap${open ? " open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delTitle"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="auth-card danger-card">
        <div className="auth-head">
          <div>
            <h3 id="delTitle">Delete your account</h3>
            <p>This is permanent and takes effect immediately.</p>
          </div>
          <button className="auth-x" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>

        <ul className="danger-list">
          <li>Your profile, name, organisation, sector, phone</li>
          <li>Every question you have asked</li>
          <li>Your login, and this session</li>
        </ul>

        <div className="auth-form">
          <div className="fld">
            <label htmlFor="delConfirm">
              Type <b>DELETE</b> to confirm
            </label>
            {/* Case-sensitive on purpose. A confirm dialog is one reflexive
                Enter away, but nobody types a word by accident. */}
            <input
              id="delConfirm"
              type="text"
              autoComplete="off"
              placeholder="DELETE"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <button className="btn-destroy" type="button" disabled={confirm !== "DELETE" || busy} onClick={onDelete}>
            {busy ? "Deleting..." : "Permanently delete my account"}
          </button>
          <button className="btn-cancel" type="button" onClick={onClose}>
            Cancel, keep my account
          </button>
        </div>

        {error && <p className="auth-msg show err">{error}</p>}

        <p className="auth-fine">
          This is your GDPR Article 17 right to erasure. No waiting period, no email exchange. See
          the <a href="/privacy">privacy policy</a>.
        </p>
      </div>
    </div>
  );
}
