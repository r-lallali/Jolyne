"use client";

import { motion } from "framer-motion";
import { useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";

const FAREWELL_DURATION_MS = 2_000;

// Petit écran qui s'affiche pendant ~2s après "Quitter" avant de retomber
// sur SetupView. Donne un signal clair "tu as bien quitté" et évite le
// saut sec vers l'écran de pseudo.
export function FarewellView() {
  const reset = useChatStore((s) => s.reset);

  useEffect(() => {
    const t = setTimeout(reset, FAREWELL_DURATION_MS);
    return () => clearTimeout(t);
  }, [reset]);

  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-2 px-6 sm:h-[92vh]">
      <motion.p
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="text-3xl font-medium text-neutral-900 dark:text-neutral-50"
      >
        Merci, à bientôt.
      </motion.p>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="text-sm text-neutral-500 dark:text-neutral-400"
      >
        Reviens pratiquer quand tu veux.
      </motion.p>
    </div>
  );
}
