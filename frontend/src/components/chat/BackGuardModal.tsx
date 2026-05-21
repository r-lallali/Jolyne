"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { SheetHandle } from "@/components/ui/SheetHandle";
import { useT } from "@/lib/i18n";

const DEFAULT_DURATION_MS = 3_000;

interface Props {
  open: boolean;
  durationMs?: number;
  onCancel: () => void;
  onConfirm: () => void;
}

// Sas de sortie : quand l'utilisateur clique sur "retour" du navigateur en
// pleine conversation, on intercepte la nav et on affiche cette modale avec
// un compteur. Annuler → on reste sur la page. Compteur à 0 → on confirme
// (close WS + history.back).
export function BackGuardModal({
  open,
  durationMs = DEFAULT_DURATION_MS,
  onCancel,
  onConfirm,
}: Props) {
  const t = useT();
  const totalS = Math.ceil(durationMs / 1000);
  const [remaining, setRemaining] = useState(totalS);

  useEffect(() => {
    if (!open) {
      setRemaining(totalS);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      const left = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));
      setRemaining(left);
      if (elapsed >= durationMs) {
        clearInterval(id);
        onConfirm();
      }
    }, 100);
    return () => clearInterval(id);
  }, [open, durationMs, totalS, onConfirm]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, y: "100%" }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-3xl bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-center shadow-xl dark:bg-neutral-950 sm:rounded-2xl sm:pb-6"
      >
        <SheetHandle />
        <div className="mx-auto flex h-14 w-14 items-center justify-center">
          <Spinner />
        </div>
        <p className="mt-4 text-base font-medium text-neutral-900 dark:text-neutral-50">
          {t.chat.backGuardTitle}
        </p>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {t.chat.backGuardHint({ s: remaining })}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="mt-5 w-full rounded-xl bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          {t.common.cancel}
        </button>
      </motion.div>
    </div>
  );
}

function Spinner() {
  return (
    <motion.svg
      className="size-12 text-neutral-900 dark:text-neutral-100"
      viewBox="0 0 50 50"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
    >
      <circle cx="25" cy="25" r="20" opacity={0.18} />
      <path d="M 25 5 A 20 20 0 0 1 45 25" />
    </motion.svg>
  );
}
