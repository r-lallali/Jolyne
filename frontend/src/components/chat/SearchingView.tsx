"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useMatch } from "@/hooks/useMatch";
import { useT } from "@/lib/i18n";
import { useChatStore } from "@/stores/chatStore";

export function SearchingView() {
  const status = useChatStore((s) => s.status);
  const peerNick = useChatStore((s) => s.peerNick);
  const { stop } = useMatch();
  const t = useT();

  // Esc = annuler. Évite d'avoir à viser le bouton sur desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop]);

  // Reconnect : on était matché, le WS a coupé. peerNick est préservé par
  // le store le temps de la transition. On utilise ça pour distinguer une
  // 1ère connexion d'une reconnexion en pleine conversation.
  const reconnecting = status === "connecting" && peerNick !== null;

  // On gèle le label sur les seuls statuts que cette vue est censée
  // afficher ("connecting"/"queued"). Sinon, au moment d'un Annuler, le
  // store passe à "ended" *avant* que l'animation d'exit ne se termine,
  // ce qui faisait flasher "Connexion" pendant ~220 ms.
  const [label, setLabel] = useState(() => {
    if (status === "queued") return t.searching.findingPeer;
    if (reconnecting) return t.chat.reconnecting;
    return t.searching.connecting;
  });
  const [sub, setSub] = useState(() =>
    status === "queued"
      ? t.searching.findingPeerHint
      : t.searching.connectingHint,
  );
  useEffect(() => {
    if (status === "queued") {
      setLabel(t.searching.findingPeer);
      setSub(t.searching.findingPeerHint);
    } else if (status === "connecting") {
      setLabel(reconnecting ? t.chat.reconnecting : t.searching.connecting);
      setSub(t.searching.connectingHint);
    }
  }, [status, t, reconnecting]);

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
        {t.searching.cancel}
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
