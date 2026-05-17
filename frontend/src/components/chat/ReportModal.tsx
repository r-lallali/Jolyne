"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { SheetHandle } from "@/components/ui/SheetHandle";
import { useT } from "@/lib/i18n";

interface Props {
  open: boolean;
  peerNick: string | null;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}

const REASON_MAX = 500;

// Modal centré : raison libre, optionnelle. Sur submit on appelle onSubmit
// puis on affiche une confirmation 1.2s, puis on ferme. Le backend a déjà
// auto-quitté la conversation, donc l'écran de fond a déjà commencé à
// transitionner vers SearchingView.
export function ReportModal({ open, peerNick, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState(false);
  const t = useT();

  // Reset à chaque ouverture/fermeture
  useEffect(() => {
    if (!open) {
      setReason("");
      setSent(false);
    }
  }, [open]);

  const submit = () => {
    onSubmit(reason.trim());
    setSent(true);
    setTimeout(() => onClose(), 1200);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: "100%" }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: "100%" }}
            transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-3xl bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl dark:bg-neutral-900 sm:rounded-2xl sm:pb-6"
          >
            <SheetHandle />
            {sent ? (
              <div className="py-4 text-center">
                <p className="text-base font-medium text-neutral-900 dark:text-neutral-100">
                  {t.report.sent}
                </p>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                  {t.report.sentHint}
                </p>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  {t.report.title({ nick: peerNick ?? "" })}
                </h2>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                  {t.report.hint}
                </p>
                <textarea
                  value={reason}
                  onChange={(e) =>
                    setReason(e.target.value.slice(0, REASON_MAX))
                  }
                  rows={4}
                  maxLength={REASON_MAX}
                  placeholder={t.report.placeholder}
                  autoFocus
                  className="mt-4 w-full resize-none rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:ring-neutral-700"
                />
                <p className="mt-1 text-right text-[11px] text-neutral-400 dark:text-neutral-600">
                  {reason.length}/{REASON_MAX}
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  >
                    {t.common.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
                  >
                    {t.report.submit}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
