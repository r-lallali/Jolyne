"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useMatch } from "@/hooks/useMatch";
import { useChatStore } from "@/stores/chatStore";

export function SearchingView() {
  const status = useChatStore((s) => s.status);
  const { stop } = useMatch();

  // On gèle le label sur les seuls statuts que cette vue est censée
  // afficher ("connecting"/"queued"). Sinon, au moment d'un Annuler, le
  // store passe à "ended" *avant* que l'animation d'exit ne se termine,
  // ce qui faisait flasher "Connexion" pendant ~220 ms.
  const [label, setLabel] = useState(() =>
    status === "queued" ? "On cherche quelqu'un" : "Connexion",
  );
  const [sub, setSub] = useState(() =>
    status === "queued"
      ? "On t'apparie avec un natif qui veut pratiquer ta langue cible."
      : "Quelques secondes — on rétablit le lien avec le serveur.",
  );
  useEffect(() => {
    if (status === "queued") {
      setLabel("On cherche quelqu'un");
      setSub("On t'apparie avec un natif qui veut pratiquer ta langue cible.");
    } else if (status === "connecting") {
      setLabel("Connexion");
      setSub("Quelques secondes — on rétablit le lien avec le serveur.");
    }
  }, [status]);

  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-10 px-6 sm:h-[92vh]">
      <BreathingOrb />
      <div className="text-center">
        <p className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
          {label}
        </p>
        <p className="mt-2 max-w-sm text-balance text-sm text-neutral-500 dark:text-neutral-400">
          {sub}
        </p>
      </div>
      <button
        type="button"
        onClick={stop}
        className="rounded-md px-4 py-2 text-sm text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        Annuler
      </button>
    </div>
  );
}

function BreathingOrb() {
  return (
    <div className="relative flex h-24 w-24 items-center justify-center">
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full border border-neutral-900/30 dark:border-neutral-100/40"
        animate={{ scale: [1, 1.6, 1.6], opacity: [0.4, 0, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
      />
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full border border-neutral-900/30 dark:border-neutral-100/40"
        animate={{ scale: [1, 1.6, 1.6], opacity: [0.4, 0, 0] }}
        transition={{
          duration: 2.2,
          repeat: Infinity,
          ease: "easeOut",
          delay: 1.1,
        }}
      />
      <motion.span
        aria-hidden
        className="h-10 w-10 rounded-full bg-neutral-900 dark:bg-neutral-100"
        animate={{ scale: [0.85, 1, 0.85], opacity: [0.85, 1, 0.85] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
