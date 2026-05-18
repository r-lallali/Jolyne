"use client";

import { motion } from "framer-motion";
import { useMatch } from "@/hooks/useMatch";
import { buzz } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useChatStore } from "@/stores/chatStore";

// Bloc inline en fin de conversation. Apparaît dès qu'elle se termine
// (peer parti ou Suivant volontaire) et propose Next/Quitter. Le bouton
// Next envoie `ClientNext` au backend — qui re-queue gratuitement si le
// peer est déjà parti, sinon avec quota.
export function PostChatCard() {
  const { next, stop } = useMatch();
  const peerNick = useChatStore((s) => s.peerNick);
  const endedBy = useChatStore((s) => s.endedBy);
  const t = useT();

  const title =
    endedBy === "peer" && peerNick
      ? t.postChat.titlePeerLeft({ nick: peerNick })
      : t.postChat.title;

  const handleNext = () => {
    buzz(15);
    next();
  };

  const handleQuit = () => {
    buzz(25);
    stop();
  };

  // Containers parents → enfants : on stagger l'entrée des sous-éléments
  // (titre, hint, boutons) pour une apparition plus fluide qu'un fade-in
  // simultané.
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.06, delayChildren: 0.04 },
    },
  };
  const item = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: "easeOut" } },
  };

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="mx-auto mt-6 flex w-full flex-col items-center gap-3 py-4"
    >
      {/* Trait de séparation : marque la frontière entre la conversation
          et le bloc d'action. Centré, fin, neutre. */}
      <motion.div
        variants={item}
        aria-hidden
        className="h-px w-16 bg-neutral-300 dark:bg-neutral-700"
      />
      <motion.div variants={item} className="text-center">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
          {title}
        </p>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {t.postChat.hint}
        </p>
      </motion.div>
      <motion.div
        variants={item}
        className="flex max-w-md flex-wrap justify-center gap-2"
      >
        <button
          type="button"
          onClick={handleNext}
          autoFocus
          className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs text-neutral-700 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          {t.postChat.next}
        </button>
        <button
          type="button"
          onClick={handleQuit}
          className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs text-neutral-700 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          {t.postChat.quit}
        </button>
      </motion.div>
    </motion.div>
  );
}
