"use client";

import { motion } from "framer-motion";

// StreakLostBanner : ligne système affichée dans le flux du chat quand
// le streak vient d'être perdu. Offre la restauration unilatérale (3 par
// mois et par conversation, compteur partagé entre les deux amis). Le
// bouton ouvre la modale StreakRestoreModal du parent — on délègue.
//
// Affichée tant que profile.lost_streak > 0 et profile.streak === 0.
// Disparaît automatiquement quand la restauration aboutit (le parent
// reset lost_streak via onRestored du modal).

interface Props {
  restoresRemaining?: number;
  onRestore: () => void;
}

export function StreakLostBanner({ restoresRemaining, onRestore }: Props) {
  const exhausted = restoresRemaining === 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="my-3 flex flex-col items-center gap-2"
    >
      {/* Texte aligné sur le style du message système juste au-dessus
          ("Streak de X jours perdu") : petit, gris, italique, centré. */}
      <p className="px-3 text-center text-[11px] italic text-neutral-400 dark:text-neutral-500">
        {typeof restoresRemaining === "number"
          ? exhausted
            ? "Les 3 restaurations de cette conversation ont été utilisées ce mois-ci."
            : `Il reste ${restoresRemaining} restauration${restoresRemaining > 1 ? "s" : ""} ce mois pour cette conversation.`
          : "Vous pouvez restaurer ce streak (3 fois par mois pour cette conversation)."}
      </p>
      <button
        type="button"
        onClick={onRestore}
        disabled={exhausted}
        className="rounded-full bg-neutral-900 px-4 py-2 text-xs font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-50 dark:text-neutral-900"
      >
        Restaurer le <span className="text-orange-500">streak</span>
      </button>
    </motion.div>
  );
}
