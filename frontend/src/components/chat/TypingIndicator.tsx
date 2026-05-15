"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useChatStore } from "@/stores/chatStore";

// Indicateur "X écrit…" rendu à la fin de la liste de messages, façon
// iMessage/WhatsApp. Bulle simple alignée à gauche (côté peer) avec 3
// points qui pulsent. Hauteur zéro quand inactif pour ne pas réserver
// d'espace fantôme.
export function TypingIndicator() {
  const peerTyping = useChatStore((s) => s.peerTyping);
  const peerNick = useChatStore((s) => s.peerNick);

  return (
    <AnimatePresence>
      {peerTyping && (
        <motion.div
          initial={{ opacity: 0, y: 4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: 0.18 }}
          className="flex w-full justify-start"
        >
          <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-neutral-200 px-3.5 py-2.5 dark:bg-neutral-800">
            <span className="sr-only">{peerNick} écrit</span>
            <Dots />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Dots() {
  return (
    <span className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-neutral-500 dark:bg-neutral-400"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
          transition={{
            duration: 1.1,
            repeat: Infinity,
            delay: i * 0.15,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}
