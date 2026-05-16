"use client";

import { motion } from "framer-motion";
import { useRef } from "react";
import { cn } from "@/lib/cn";

interface Props {
  from: "me" | "peer";
  body: string;
  // Appelé quand l'utilisateur sélectionne du texte dans une bulle peer.
  // Permet à la liste d'ancrer un tooltip de traduction.
  onSelect?: (text: string, rect: DOMRect) => void;
}

// Bulles asymétriques :
//   - moi  : alignées à droite, fond inversé (sombre en light, clair en dark)
//   - peer : alignées à gauche, fond doux (gris clair en light, gris foncé en dark)
export function MessageBubble({ from, body, onSelect }: Props) {
  const mine = from === "me";
  const ref = useRef<HTMLParagraphElement>(null);

  const handleSelect = () => {
    if (mine || !onSelect) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    // Garde-fous : pas vide, pas un roman, contenu dans cette bulle.
    if (!text || text.length > 200) return;
    const range = sel.getRangeAt(0);
    if (!ref.current?.contains(range.commonAncestorContainer)) return;
    onSelect(text, range.getBoundingClientRect());
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
    >
      <p
        ref={ref}
        onMouseUp={handleSelect}
        onTouchEnd={handleSelect}
        className={cn(
          "max-w-[78%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug",
          mine
            ? "rounded-br-sm bg-neutral-900 text-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
            : "rounded-bl-sm cursor-text bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100",
        )}
      >
        {body}
      </p>
    </motion.div>
  );
}
