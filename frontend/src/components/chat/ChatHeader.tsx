"use client";

import { motion } from "framer-motion";

interface Props {
  peerNick: string | null;
  onNext: () => void;
  onStop: () => void;
}

// Pas de bordure, pas de fond — juste un peu de padding. Le `pr-12 sm:pr-0`
// laisse l'espace pour le ThemeToggle fixe en haut à droite sur mobile (sur
// desktop le chat est centré, le toggle est loin sur la droite de la page).
export function ChatHeader({ peerNick, onNext, onStop }: Props) {
  return (
    <header className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <motion.span
          aria-hidden
          animate={{ opacity: [1, 0.5, 1], scale: [1, 1.15, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="inline-block size-2 rounded-full bg-emerald-500"
        />
        <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {peerNick ?? "—"}
        </p>
      </div>
      <div className="flex items-center gap-1 pr-12 sm:pr-0">
        <button
          type="button"
          onClick={onNext}
          className="rounded-full px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
        >
          Suivant
        </button>
        <button
          type="button"
          onClick={onStop}
          className="rounded-full px-3 py-1.5 text-xs text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          Quitter
        </button>
      </div>
    </header>
  );
}
