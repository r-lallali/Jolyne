"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import type { BanDuration } from "@/lib/admin";

interface Props {
  open: boolean;
  peerNick: string;
  onClose: () => void;
  onSubmit: (duration: BanDuration, reason: string) => Promise<void>;
}

const DURATIONS: { v: BanDuration; label: string }[] = [
  { v: "24h", label: "24 heures" },
  { v: "7d", label: "7 jours" },
  { v: "30d", label: "30 jours" },
  { v: "permanent", label: "Permanent" },
];

export function BanModal({ open, peerNick, onClose, onSubmit }: Props) {
  const [duration, setDuration] = useState<BanDuration>("7d");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      await onSubmit(duration, reason.trim());
      onClose();
    } catch {
      setErr("Échec du bannissement");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-neutral-900"
          >
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Bannir {peerNick}
            </h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Le ban couvre l&apos;IP hashée et le fingerprint. Le signalement
              passera en « résolu » automatiquement.
            </p>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-500">
                  Durée
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {DURATIONS.map((d) => (
                    <button
                      key={d.v}
                      type="button"
                      onClick={() => setDuration(d.v)}
                      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        duration === d.v
                          ? d.v === "permanent"
                            ? "bg-red-600 text-white"
                            : "bg-neutral-900 text-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
                          : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                {duration === "permanent" && (
                  <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
                    Permanent = jamais d&apos;expiration automatique. Réservé
                    aux cas graves (cf. CLAUDE.md §7).
                  </p>
                )}
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-500">
                  Raison (visible par l&apos;utilisateur banni)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, 300))}
                  rows={3}
                  placeholder="Harcèlement, propos haineux, etc."
                  className="w-full resize-none rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </div>
            </div>

            {err && (
              <p className="mt-3 text-xs text-red-600 dark:text-red-400">
                {err}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-200 disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-30"
              >
                {busy ? "Bannissement…" : "Confirmer le ban"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
