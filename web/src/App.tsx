import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "./lib/useSession";
import Nav from "./components/Nav";
import Hero from "./components/Hero";
import Ask from "./components/Ask";
import AuthDialog from "./components/AuthDialog";
import DeleteDialog from "./components/DeleteDialog";
import { TrustBar, Features, Coverage, Footer } from "./components/Sections";

export default function App() {
  const auth = useSession();
  const [authOpen, setAuthOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toast, setToast] = useState("");
  const timer = useRef<number | undefined>(undefined);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(""), 1800);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Close the sign-in dialog once a session appears, whether it arrived from the
  // code step or from a magic link opened in another tab.
  useEffect(() => {
    if (auth.session) setAuthOpen(false);
  }, [auth.session]);

  return (
    <div className="page">
      <header className="hero">
        <Nav
          auth={auth}
          onOpenAuth={() => setAuthOpen(true)}
          onOpenDelete={() => setDeleteOpen(true)}
          onToast={showToast}
        />
        <Hero />
      </header>

      <TrustBar />
      <Features />
      <Ask auth={auth} onOpenAuth={() => setAuthOpen(true)} />
      <Coverage />
      <Footer />

      <AuthDialog auth={auth} open={authOpen} onClose={() => setAuthOpen(false)} />
      <DeleteDialog
        auth={auth}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={(count) => showToast(`Account deleted, ${count} question(s) erased`)}
      />

      <div className={`toast${toast ? " show" : ""}`}>{toast}</div>
    </div>
  );
}
