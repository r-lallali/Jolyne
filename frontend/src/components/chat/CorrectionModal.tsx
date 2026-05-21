"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { SheetHandle } from "@/components/ui/SheetHandle";
import { useT } from "@/lib/i18n";

interface Props {
  open: boolean;
  original: string;
  peerNick: string | null;
  // Valeurs préremplies (mode édition d'une correction déjà envoyée).
  initialCorrected?: string;
  initialNote?: string;
  onClose: () => void;
  onSubmit: (corrected: string, note: string) => void;
}

// Modal HelloTalk-style : on pré-remplit avec le message original (ou la
// correction en cours si on édite), le user l'édite, et peut ajouter une
// note pédagogique courte.
export function CorrectionModal({
  open,
  original,
  peerNick,
  initialCorrected,
  initialNote,
  onClose,
  onSubmit,
}: Props) {
  const [corrected, setCorrected] = useState(initialCorrected ?? original);
  const [note, setNote] = useState(initialNote ?? "");
  const t = useT();

  useEffect(() => {
    if (open) {
      setCorrected(initialCorrected ?? original);
      setNote(initialNote ?? "");
    }
  }, [open, original, initialCorrected, initialNote]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const trimmed = corrected.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== original.trim();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(trimmed, note.trim());
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <motion.form
        initial={{ opacity: 0, y: "100%" }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: "100%" }}
        transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl dark:bg-neutral-950 sm:rounded-2xl sm:pb-5"
      >
        <SheetHandle />
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          {t.correction.title({ nick: peerNick ?? t.correction.fallbackPeer })}
        </h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {t.correction.hint}
        </p>

        <label className="mt-4 block text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {t.correction.original}
        </label>
        <p className="mt-1 rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
          {original}
        </p>

        <label
          htmlFor="correction"
          className="mt-4 block text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400"
        >
          {t.correction.yourCorrection}
        </label>
        <textarea
          id="correction"
          value={corrected}
          onChange={(e) => setCorrected(e.target.value)}
          maxLength={2000}
          rows={3}
          className="mt-1 w-full resize-none rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-900 outline-none ring-1 ring-transparent transition-all focus:ring-neutral-300 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-700"
          autoFocus
        />

        <label
          htmlFor="note"
          className="mt-3 block text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400"
        >
          {t.correction.note}
        </label>
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder={t.correction.notePlaceholder}
          className="mt-1 w-full resize-none rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-900 outline-none ring-1 ring-transparent transition-all placeholder:text-neutral-500 focus:ring-neutral-300 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-700"
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            {t.common.cancel}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-50 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-neutral-50 dark:text-neutral-900"
          >
            {t.correction.submit}
          </button>
        </div>
      </motion.form>
    </div>
  );
}
