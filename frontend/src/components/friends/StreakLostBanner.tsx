"use client";

import { motion } from "framer-motion";

// StreakLostBanner : ligne système affichée dans le flux du chat quand
// le streak vient d'être perdu. Offre la restauration mutuelle (3 par
// mois). Le bouton ouvre la modale StreakRestoreModal du parent — pas
// d'action directe ici, on délègue.
//
// Affichée tant que profile.lost_streak > 0 et profile.streak === 0.
// Disparaît automatiquement quand la restauration aboutit (le parent
// reset lost_streak via onRestored du modal).

interface Props {
  lostStreak: number;
  peerName: string;
  restoresRemaining?: number;
  onRestore: () => void;
}

export function StreakLostBanner({
  lostStreak,
  peerName,
  restoresRemaining,
  onRestore,
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="my-3 flex flex-col items-center gap-2"
    >
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-center dark:border-neutral-800 dark:bg-neutral-900/60">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
          <span aria-hidden className="mr-1">💔</span>
          Streak perdu — {lostStreak} jours avec {peerName}
        </p>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {typeof restoresRemaining === "number"
            ? restoresRemaining > 0
              ? `Il te reste ${restoresRemaining} restauration${restoresRemaining > 1 ? "s" : ""} ce mois. Si ${peerName} accepte aussi, le streak repart à ${lostStreak}.`
              : `Tu as utilisé tes 3 restaurations ce mois-ci.`
            : `Vous pouvez restaurer ce streak (3 fois par mois, accord mutuel).`}
        </p>
        <button
          type="button"
          onClick={onRestore}
          disabled={restoresRemaining === 0}
          className="mt-3 inline-flex items-center gap-1 rounded-full bg-neutral-900 px-4 py-2 text-xs font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-50 dark:text-neutral-900"
        >
          <span aria-hidden>🔥</span>
          Restaurer le streak
        </button>
      </div>
    </motion.div>
  );
}
