"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  EmailForm,
  Forgot,
  Landing,
} from "@/components/auth/AuthViews";
import { BackIcon, CloseIcon } from "@/components/auth/icons";
import { SheetHandle } from "@/components/ui/SheetHandle";
import { useAuthForm } from "@/hooks/useAuthForm";
import { getOAuthProviders, type OAuthProvider } from "@/lib/auth";
import { useT } from "@/lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
}

// Vues de la feuille, en profondeur croissante : landing (choix social /
// e-mail) → email (login ou signup) → forgot. Le sens du slide en dérive.
type View = "landing" | "email" | "forgot";

const DEPTH: Record<View, number> = { landing: 0, email: 1, forgot: 2 };

// Feuille d'authentification pour les flows contextuels (paywall, ajout
// d'ami) : bottom-sheet (mobile) / carte centrée (desktop), social-first.
// La destination canonique du bouton « Se connecter » est la page /auth.
// z-[80] : au-dessus du PaywallModal (z-[70]) qui peut l'ouvrir.
export function LoginSheet({ open, onClose }: Props) {
  const t = useT();
  const form = useAuthForm("login", onClose);
  const [view, setView] = useState<View>("landing");
  const [dir, setDir] = useState(1);
  const [providers, setProviders] = useState<OAuthProvider[] | null>(null);

  // Référence stable pour reset (le hook renvoie un objet neuf par render).
  const resetRef = useRef(form.reset);
  resetRef.current = form.reset;

  // État propre à chaque (ré)ouverture.
  useEffect(() => {
    if (open) {
      setView("landing");
      setDir(1);
      resetRef.current();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void getOAuthProviders().then((list) => {
      if (alive) setProviders(list);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  // Aucun provider configuré → la vue landing ne propose que l'e-mail,
  // autant sauter l'étape.
  useEffect(() => {
    if (open && view === "landing" && providers !== null && providers.length === 0) {
      setView("email");
    }
  }, [open, view, providers]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const goTo = (next: View) => {
    setDir(DEPTH[next] > DEPTH[view] ? 1 : -1);
    setView(next);
    form.setSent(false);
  };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <motion.form
        initial={{ y: 32, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void (view === "forgot" ? form.submitForgot() : form.submitCredentials());
        }}
        className="relative w-full max-w-sm overflow-hidden rounded-t-3xl bg-white px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 shadow-2xl dark:bg-neutral-950 sm:rounded-3xl sm:px-7 sm:pb-6"
      >
        <SheetHandle />
        {view !== "landing" && (
          <button
            type="button"
            onClick={() => goTo(view === "forgot" ? "email" : "landing")}
            aria-label={t.common.back}
            className="absolute left-3 top-3 inline-flex size-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
          >
            <BackIcon />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
        >
          <CloseIcon />
        </button>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view + (view === "email" ? form.mode : "")}
            initial={{ x: dir * 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir * -24, opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            {view === "landing" && (
              <Landing
                t={t}
                providers={providers ?? []}
                busy={form.busy}
                onOAuth={form.startOAuthFlow}
                onEmail={() => goTo("email")}
              />
            )}
            {view === "email" && (
              <EmailForm
                t={t}
                mode={form.mode}
                busy={form.busy}
                err={form.err}
                fields={form.fields}
                set={form.set}
                onSwitchMode={form.switchMode}
                onForgot={() => goTo("forgot")}
              />
            )}
            {view === "forgot" && (
              <Forgot
                t={t}
                sent={form.sent}
                busy={form.busy}
                err={form.err}
                email={form.fields.email}
                setEmail={form.set.setEmail}
                onDone={onClose}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </motion.form>
    </motion.div>
  );
}
