"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { buzz } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

interface Props {
  peerNick: string | null;
  onNext: () => void;
  onStop: () => void;
  onReport: () => void;
  canReport: boolean;
  canNext: boolean;
}

export function ChatHeader({
  peerNick,
  onNext,
  onStop,
  onReport,
  canReport,
  canNext,
}: Props) {
  const t = useT();
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
          onClick={onReport}
          disabled={!canReport}
          aria-label={t.chat.reportLabel}
          title={t.chat.reportTitle}
          className="inline-flex size-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-500 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-red-400"
        >
          <FlagIcon />
        </button>
        <button
          type="button"
          onClick={() => {
            if (!canNext) return;
            buzz(15);
            onNext();
          }}
          disabled={!canNext}
          className="rounded-full px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-neutral-300 dark:hover:bg-neutral-900"
        >
          {t.chat.next}
        </button>
        <QuitButton
          onConfirm={onStop}
          quitLabel={t.chat.quit}
          confirmLabel={t.chat.confirmQuit}
        />
      </div>
    </header>
  );
}

function FlagIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 22V4" />
      <path d="M4 4h12l-2 4 2 4H4" />
    </svg>
  );
}

// QuitButton : click-to-confirm. Premier clic → "Confirmer ?" en rouge
// pendant 3s. Second clic dans la fenêtre → onConfirm. Sinon, revient à
// "Quitter" silencieusement. Évite les mauvaises manips sur mobile.
function QuitButton({
  onConfirm,
  quitLabel,
  confirmLabel,
}: {
  onConfirm: () => void;
  quitLabel: string;
  confirmLabel: string;
}) {
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
      {armed ? confirmLabel : quitLabel}
    </button>
  );
}
