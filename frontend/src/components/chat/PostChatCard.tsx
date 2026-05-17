"use client";

import { motion } from "framer-motion";
import { useMatch } from "@/hooks/useMatch";
import { buzz } from "@/lib/haptics";
import { useT } from "@/lib/i18n";

// Bloc inline qui apparaît à la fin de la conversation quand celle-ci
// se termine (peer parti ou Suivant côté nous). Deux gros boutons : Next
// (re-queue gratuit si peer déjà parti, sinon chatNext) et Quitter
// (ferme la WS). L'utilisateur peut scroller au-dessus pour relire ses
// messages avant de choisir.
export function PostChatCard() {
  const { next, stop } = useMatch();
  const t = useT();

  const handleNext = () => {
    buzz(15);
    next();
  };

  const handleQuit = () => {
    buzz(25);
    stop();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="mt-4 flex flex-col items-stretch gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/60"
    >
      <div className="text-center">
        <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          {t.postChat.title}
        </p>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {t.postChat.hint}
        </p>
      </div>
      <button
        type="button"
        onClick={handleNext}
        autoFocus
        className="w-full rounded-2xl bg-neutral-900 px-6 py-4 text-base font-semibold text-neutral-50 transition-opacity hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
      >
        {t.postChat.next}
      </button>
      <button
        type="button"
        onClick={handleQuit}
        className="w-full rounded-2xl bg-neutral-100 px-6 py-4 text-base font-medium text-neutral-700 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
      >
        {t.postChat.quit}
      </button>
    </motion.div>
  );
}
