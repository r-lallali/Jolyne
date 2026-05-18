"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { SheetHandle } from "@/components/ui/SheetHandle";
import { AuthError, requestMagicLink } from "@/lib/auth";
import { useT } from "@/lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Bottom-sheet (mobile) / modal centrée (desktop) pour demander un magic
// link par email. Le backend renvoie toujours 204 → le UX ne révèle pas
// quels emails existent. On affiche "Lien envoyé" dans tous les cas.
export function LoginSheet({ open, onClose }: Props) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setSent(false);
      setBusy(false);
      setErr(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setErr(t.auth.invalidEmail);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await requestMagicLink(trimmed);
      setSent(true);
    } catch (e) {
      setErr(e instanceof AuthError ? "Service indisponible" : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <motion.form
        initial={{ opacity: 0, y: "100%" }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: "100%" }}
        transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-t-3xl bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-xl dark:bg-neutral-950 sm:rounded-2xl sm:pb-6"
      >
        <SheetHandle />

        {sent ? (
          <div className="py-4 text-center">
            <p className="text-base font-medium text-neutral-900 dark:text-neutral-50">
              {t.auth.linkSent}
            </p>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {t.auth.linkSentHint}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 w-full rounded-xl bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {t.common.close}
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
              {t.auth.loginTitle}
            </h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {t.auth.loginHint}
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.auth.emailPlaceholder}
              autoFocus
              autoComplete="email"
              inputMode="email"
              className="mt-4 w-full rounded-xl bg-neutral-100 px-4 py-3 text-base text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-700"
            />
            {err && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                {err}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-2 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:opacity-30 dark:bg-neutral-50 dark:text-neutral-900"
              >
                {t.auth.sendLink}
              </button>
            </div>
          </>
        )}
      </motion.form>
    </div>
  );
}
