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
  // Timestamp du début du cooldown anti-zap (null hors période).
  cooldownStart: number | null;
  cooldownMs: number;
}

export function ChatHeader({
  peerNick,
  onNext,
  onStop,
  onReport,
  canReport,
  canNext,
  cooldownStart,
  cooldownMs,
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
        <NextButton
          canNext={canNext}
          cooldownStart={cooldownStart}
          cooldownMs={cooldownMs}
          onConfirm={onNext}
          nextLabel={t.chat.next}
          confirmLabel={t.chat.confirmQuit}
        />
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

// NextButton : pill text avec ring pill countdown + click-to-confirm.
// Le ring suit la forme pill du bouton (pas un cercle parfait, parce que
// le texte rend la forme rectangulaire). Click 1 → "Confirmer ?" 3s ;
// click 2 → onConfirm.
function NextButton({
  canNext,
  cooldownStart,
  cooldownMs,
  onConfirm,
  nextLabel,
  confirmLabel,
}: {
  canNext: boolean;
  cooldownStart: number | null;
  cooldownMs: number;
  onConfirm: () => void;
  nextLabel: string;
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

  useEffect(() => {
    if (cooldownStart !== null) {
      setArmed(false);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [cooldownStart]);

  const click = () => {
    if (!canNext) return;
    if (armed) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      setArmed(false);
      buzz(15);
      onConfirm();
      return;
    }
    setArmed(true);
    timerRef.current = setTimeout(() => {
      setArmed(false);
      timerRef.current = null;
    }, 3000);
  };

  const showRing = cooldownStart !== null && !canNext;

  return (
    <span className="relative inline-flex items-center justify-center">
      {showRing && (
        <CooldownRing key={cooldownStart} durationMs={cooldownMs} />
      )}
      <button
        type="button"
        onClick={click}
        disabled={!canNext}
        className={cn(
          "relative rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
          armed
            ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:bg-emerald-500/15 dark:text-emerald-400"
            : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900",
          !canNext &&
            "cursor-not-allowed text-neutral-400 hover:bg-transparent dark:text-neutral-600",
        )}
      >
        {armed ? confirmLabel : nextLabel}
      </button>
    </span>
  );
}

// CooldownRing : contour pill qui se vide en durationMs. SVG étendu de
// -inset-1.5 autour du bouton, stroke 3px noir/blanc selon le thème.
// pathLength normalisé pour anim linéaire quelle que soit la largeur du
// rectangle arrondi. Remonté à chaque nouveau cooldown via key parent.
function CooldownRing({ durationMs }: { durationMs: number }) {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute -inset-1.5 h-[calc(100%+0.75rem)] w-[calc(100%+0.75rem)] text-neutral-900 dark:text-neutral-50"
      preserveAspectRatio="none"
      viewBox="0 0 100 40"
    >
      <motion.rect
        x="1.5"
        y="1.5"
        width="97"
        height="37"
        rx="20"
        ry="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        strokeDasharray="1 1"
        initial={{ strokeDashoffset: 0 }}
        animate={{ strokeDashoffset: -1 }}
        transition={{ duration: durationMs / 1000, ease: "linear" }}
      />
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
