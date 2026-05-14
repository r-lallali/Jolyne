"use client";

import { motion } from "framer-motion";
import { useChatStore } from "@/stores/chatStore";

interface Props {
  from: "me" | "peer";
  body: string;
}

// Style "turn" à la Claude/Gemini : pleine largeur, label d'auteur au-dessus,
// pas de bulle de fond. La distinction visuelle me/peer se fait par le label.
export function MessageBubble({ from, body }: Props) {
  const peerNick = useChatStore((s) => s.peerNick);
  const author = from === "me" ? "Toi" : (peerNick ?? "—");
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="px-4 py-3 sm:px-6 sm:py-4"
    >
      <p className="mb-1.5 text-xs font-medium tracking-wide text-neutral-500 dark:text-neutral-400">
        {author}
      </p>
      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-neutral-800 dark:text-neutral-100">
        {body}
      </p>
    </motion.div>
  );
}
