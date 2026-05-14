"use client";

import { motion } from "framer-motion";
import { useMatch } from "@/hooks/useMatch";
import { useChatStore } from "@/stores/chatStore";

// SearchingView est l'écran central animé qui couvre les status :
//   - connecting : on (re)contacte le gateway
//   - queued     : on attend qu'un peer arrive en file miroir
//
// Apparaît aussi automatiquement après un peer_left (le store passe en
// "queued" et l'utilisateur voit qu'on cherche quelqu'un d'autre).
export function SearchingView() {
  const status = useChatStore((s) => s.status);
  const { stop } = useMatch();

  const queued = status === "queued";
  const label = queued ? "On cherche quelqu'un" : "Connexion";
  const sub = queued
    ? "On t'apparie avec un natif qui veut pratiquer ta langue cible."
    : "Quelques secondes — on rétablit le lien avec le serveur.";

  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-10 px-6 sm:h-[88vh] sm:max-w-3xl sm:rounded-2xl sm:border sm:border-neutral-900/70 sm:bg-neutral-950/40 sm:shadow-2xl sm:backdrop-blur">
      <BreathingOrb />

      <div className="text-center">
        <p className="text-lg font-medium text-neutral-100">{label}</p>
        <p className="mt-2 max-w-sm text-balance text-sm text-neutral-500">
          {sub}
        </p>
      </div>

      <button
        type="button"
        onClick={stop}
        className="rounded-md px-4 py-2 text-sm text-neutral-500 transition-colors hover:text-neutral-200"
      >
        Annuler
      </button>
    </div>
  );
}

// BreathingOrb : un cercle qui respire + un anneau qui s'expand en boucle.
// Pas trop chargé, on garde la sobriété monochrome.
function BreathingOrb() {
  return (
    <div className="relative flex h-24 w-24 items-center justify-center">
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full border border-neutral-100/40"
        animate={{ scale: [1, 1.6, 1.6], opacity: [0.4, 0, 0] }}
        transition={{
          duration: 2.2,
          repeat: Infinity,
          ease: "easeOut",
        }}
      />
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full border border-neutral-100/40"
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
        className="h-10 w-10 rounded-full bg-neutral-100"
        animate={{ scale: [0.85, 1, 0.85], opacity: [0.85, 1, 0.85] }}
        transition={{
          duration: 2.2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
    </div>
  );
}
