"use client";

import { motion } from "framer-motion";
import { useMatch } from "@/hooks/useMatch";
import { buzz } from "@/lib/haptics";
import { useT } from "@/lib/i18n";

// Écran de fin de conversation. Apparaît dès que la conv se termine —
// peer parti ou décision volontaire de notre côté. Le backend reste en
// attente (`peerGone`) jusqu'à ce qu'on envoie Next (re-queue gratuit)
// ou qu'on coupe la WS via Quitter.
export function PostChatView() {
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
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-8 px-6 sm:h-[92vh]">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="text-center"
      >
        <p className="text-2xl font-medium text-neutral-900 dark:text-neutral-50 sm:text-3xl">
          {t.postChat.title}
        </p>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          {t.postChat.hint}
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.08, ease: "easeOut" }}
        className="flex w-full max-w-sm flex-col gap-3"
      >
        <button
          type="button"
          onClick={handleNext}
          autoFocus
          className="w-full rounded-2xl bg-neutral-900 px-6 py-5 text-lg font-semibold text-neutral-50 transition-opacity hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
        >
          {t.postChat.next}
        </button>
        <button
          type="button"
          onClick={handleQuit}
          className="w-full rounded-2xl bg-neutral-100 px-6 py-5 text-lg font-medium text-neutral-700 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          {t.postChat.quit}
        </button>
      </motion.div>
    </div>
  );
}
