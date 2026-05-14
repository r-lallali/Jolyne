"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useChatStore } from "@/stores/chatStore";

// Wordmark rendu au niveau du body (en dehors de l'AnimatePresence de
// Conversation) pour éviter que le transform `y` de la transition affecte
// son position:fixed. Conditionné à status="matched" pour n'apparaître que
// pendant une conversation active.
export function ChatWordmark() {
  const status = useChatStore((s) => s.status);
  const show = status === "matched";
  return (
    <AnimatePresence>
      {show && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="pointer-events-none fixed left-5 top-5 z-40 hidden text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:block"
        >
          Jolyne
        </motion.p>
      )}
    </AnimatePresence>
  );
}
