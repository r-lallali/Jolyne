"use client";

import { motion } from "framer-motion";

// StreakBadge : flamme + compteur. N'affiche rien tant que streak < 2.
// Variantes :
//   - normal      : 🔥 N orange
//   - at-risk     : ⌛ N jaune, pulse léger
//   - lost (clickable) : 💔 N gris, ouvre la modal restauration
//
// Si onRestoreClick est fourni + lostStreak > 0, on prend la priorité
// "lost" sur la flamme normale (visuel de récupération possible).

interface Props {
  streak: number;
  atRisk: boolean;
  lostStreak?: number;
  onRestoreClick?: () => void;
  size?: "sm" | "md";
}

export function StreakBadge({
  streak,
  atRisk,
  lostStreak = 0,
  onRestoreClick,
  size = "sm",
}: Props) {
  const lost = streak === 0 && lostStreak >= 2 && !!onRestoreClick;
  const show = streak >= 2 || lost;
  if (!show) return null;

  const padding = size === "md" ? "px-2 py-0.5" : "px-1.5 py-0";
  const text = size === "md" ? "text-xs" : "text-[11px]";

  if (lost) {
    return (
      <button
        type="button"
        onClick={onRestoreClick}
        title="Restaurer ce streak"
        className={`inline-flex items-center gap-0.5 rounded-full bg-neutral-100 ${padding} ${text} font-semibold text-neutral-500 transition-colors hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700`}
      >
        <span aria-hidden>💔</span>
        <span>{lostStreak}</span>
      </button>
    );
  }

  const colorCls = atRisk
    ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
    : "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400";

  return (
    <motion.span
      key={streak}
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 22 }}
      className={`inline-flex items-center gap-0.5 rounded-full ${padding} ${text} font-semibold ${colorCls} ${atRisk ? "animate-pulse" : ""}`}
      aria-label={atRisk ? `Streak ${streak} en péril` : `Streak ${streak}`}
    >
      <span aria-hidden>{atRisk ? "⌛" : "🔥"}</span>
      <span>{streak}</span>
    </motion.span>
  );
}
