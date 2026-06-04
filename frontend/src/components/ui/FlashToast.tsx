"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { useFlashStore } from "@/stores/flashStore";

// FlashToast : petite pastille verte centrée en haut de l'écran, montée à
// la racine. Affiche le message du flashStore puis s'efface seule après
// FLASH_TTL_MS. Survit aux navigations (ex. save sur /account → retour
// sur la home), le toast apparaissant sur la page d'arrivée.
const FLASH_TTL_MS = 2500;

export function FlashToast() {
  const message = useFlashStore((s) => s.message);
  const clear = useFlashStore((s) => s.clear);

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(clear, FLASH_TTL_MS);
    return () => clearTimeout(id);
  }, [message, clear]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[70] flex justify-center px-4 sm:top-4">
      <AnimatePresence>
        {message && (
          <motion.div
            key={message}
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-lg"
          >
            <CheckIcon />
            <span>{message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12.5l5 5 9-11" />
    </svg>
  );
}
