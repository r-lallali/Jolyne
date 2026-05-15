"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useChatStore } from "@/stores/chatStore";

// Indicateur "X écrit…" : 3 points qui pulsent en cascade. Apparaît/disparaît
// en fondu, hauteur fixe pour ne pas faire sauter l'input. Le store gère
// l'auto-clear après 3.5s sans nouvel event typing.
export function TypingIndicator() {
  const peerTyping = useChatStore((s) => s.peerTyping);
  const peerNick = useChatStore((s) => s.peerNick);

  return (
    <div className="h-6 px-4 sm:px-6">
      <AnimatePresence>
        {peerTyping && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="mx-auto flex w-full max-w-2xl items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400"
          >
            <span>
              <span className="font-medium text-neutral-700 dark:text-neutral-300">
                {peerNick}
              </span>{" "}
              écrit
            </span>
            <Dots />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Dots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1 rounded-full bg-neutral-500 dark:bg-neutral-400"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.15,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}
