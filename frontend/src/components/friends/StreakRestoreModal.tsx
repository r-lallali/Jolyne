"use client";

import { useEffect, useState } from "react";
import { restoreStreak, type RestoreStreakResult } from "@/lib/friends";

// StreakRestoreModal : confirme la restauration d'un streak perdu.
// 3 jetons par mois et par user, consommés uniquement quand les deux
// côtés ont posé leur demande dans une fenêtre de 7 jours.
//
// États possibles affichés :
//   - initial : "Restaurer X jours ?" + bouton confirmer
//   - pending : "En attente de [peer]" — demande posée, on attend
//   - done    : "Streak restauré 🔥" — affiché brièvement puis ferme
//   - error   : message selon err_code (quota, fenêtre expirée, etc.)

type State =
  | { kind: "initial" }
  | { kind: "loading" }
  | { kind: "pending"; result: RestoreStreakResult }
  | { kind: "done"; result: RestoreStreakResult }
  | { kind: "error"; message: string };

export function StreakRestoreModal({
  open,
  friendId,
  lostStreak,
  peerName,
  onClose,
  onRestored,
}: {
  open: boolean;
  friendId: number;
  lostStreak: number;
  peerName: string;
  onClose: () => void;
  onRestored?: (newStreak: number) => void;
}) {
  const [state, setState] = useState<State>({ kind: "initial" });

  useEffect(() => {
    if (open) setState({ kind: "initial" });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const confirm = async () => {
    setState({ kind: "loading" });
    try {
      const result = await restoreStreak(friendId);
      if (result.err_code === "quota_exhausted") {
        setState({
          kind: "error",
          message: "Tu as utilisé tes 3 restaurations ce mois-ci.",
        });
        return;
      }
      if (result.err_code === "window_expired") {
        setState({
          kind: "error",
          message: "Trop tard — le streak n'est plus restaurable.",
        });
        return;
      }
      if (result.err_code === "no_loss") {
        setState({
          kind: "error",
          message: "Aucun streak à restaurer.",
        });
        return;
      }
      if (result.restored) {
        setState({ kind: "done", result });
        onRestored?.(result.new_streak);
        setTimeout(onClose, 1800);
      } else if (result.pending) {
        setState({ kind: "pending", result });
      }
    } catch {
      setState({ kind: "error", message: "Erreur réseau, réessaie." });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-3xl bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-xl dark:bg-neutral-950 sm:rounded-3xl sm:pb-6"
      >
        {state.kind === "done" ? (
          <>
            <p className="text-center text-3xl">🔥</p>
            <p className="mt-2 text-center text-base font-semibold text-neutral-900 dark:text-neutral-50">
              Streak restauré !
            </p>
            <p className="mt-1 text-center text-sm text-neutral-500 dark:text-neutral-400">
              Vous repartez à {state.result.new_streak} jours.
            </p>
          </>
        ) : state.kind === "pending" ? (
          <>
            <p className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
              En attente de {peerName}
            </p>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Ta demande est posée. Quand {peerName} validera de son côté
              (dans les 7 jours), le streak repartira à {lostStreak} jours.
              Il te reste {state.result.remaining_this_month} restauration
              {state.result.remaining_this_month === 1 ? "" : "s"} ce mois.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 w-full rounded-xl bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Fermer
            </button>
          </>
        ) : state.kind === "error" ? (
          <>
            <p className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
              Impossible de restaurer
            </p>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {state.message}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 w-full rounded-xl bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Fermer
            </button>
          </>
        ) : (
          <>
            <p className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
              Restaurer le streak ?
            </p>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Vous aviez {lostStreak} jours d&apos;affilée avec {peerName}.
              Si {peerName} accepte aussi dans les 7 jours, le streak
              repartira à {lostStreak}. Cela consomme 1 restauration de
              chaque côté (3 par mois).
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={confirm}
                disabled={state.kind === "loading"}
                className="w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-neutral-50 dark:text-neutral-900"
              >
                {state.kind === "loading" ? "Envoi…" : "Demander la restauration"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                Annuler
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
