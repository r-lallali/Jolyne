"use client";

import { motion } from "framer-motion";

interface Props {
  peerNick: string | null;
  onNext: () => void;
  onStop: () => void;
}

// ChatHeader n'est rendu qu'en status="matched" (la SearchingView prend
// les autres cas), donc on assume toujours peer en ligne — pas de logique
// d'état conditionnel.
export function ChatHeader({ peerNick, onNext, onStop }: Props) {
  return (
    <header className="flex items-center justify-between border-b border-neutral-900/70 bg-neutral-950/60 px-4 py-3 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <motion.span
          aria-hidden
          animate={{ opacity: [1, 0.45, 1], scale: [1, 1.15, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="inline-block size-2 rounded-full bg-emerald-400 shadow-[0_0_10px_-2px_rgba(74,222,128,0.7)]"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-neutral-100">
            {peerNick ?? "—"}
          </p>
          <p className="text-xs text-neutral-500">en ligne</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onNext}
          className="rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-900"
        >
          Suivant
        </button>
        <button
          type="button"
          onClick={onStop}
          className="rounded-md px-3 py-1.5 text-xs text-neutral-500 transition-colors hover:text-neutral-300"
        >
          Quitter
        </button>
      </div>
    </header>
  );
}
