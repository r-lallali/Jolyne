"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface Props {
  peerNick: string | null;
  onNext: () => void;
  onStop: () => void;
}

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
        <QuitButton onConfirm={onStop} />
      </div>
    </header>
  );
}

// QuitButton : click-to-confirm. Premier clic → "Confirmer ?" en rouge
// pendant 3s. Second clic dans la fenêtre → onConfirm. Sinon, revient à
// "Quitter" silencieusement. Évite les mauvaises manips sur mobile.
function QuitButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const click = () => {
    if (armed) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      setArmed(false);
      onConfirm();
      return;
    }
    setArmed(true);
    timerRef.current = setTimeout(() => {
      setArmed(false);
      timerRef.current = null;
    }, 3000);
  };

  return (
    <button
      type="button"
      onClick={click}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
        armed
          ? "bg-red-500/10 text-red-600 hover:bg-red-500/15 dark:bg-red-500/15 dark:text-red-400"
          : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
      )}
    >
      {armed ? "Confirmer ?" : "Quitter"}
    </button>
  );
}
