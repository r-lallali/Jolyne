"use client";

import { motion } from "framer-motion";

// StreakBadge : emoji + compteur, sans fond coloré. N'affiche rien tant
// que streak < 2.
// Variantes :
//   - normal      : 🔥 N
//   - at-risk     : ⌛ N (pulse léger pour signaler le risque)
//   - lost (clickable) : 💔 N, ouvre la modal restauration
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

  const text = size === "md" ? "text-sm" : "text-xs";
  const gap = size === "md" ? "gap-1" : "gap-0.5";

  if (lost) {
    return (
      <button
        type="button"
        onClick={onRestoreClick}
        title="Restaurer ce streak"
        className={`inline-flex items-center ${gap} ${text} font-semibold text-neutral-500 transition-opacity hover:opacity-80 dark:text-neutral-400`}
      >
        <span aria-hidden>💔</span>
        <span>{lostStreak}</span>
      </button>
    );
  }

  return (
    <motion.span
      key={streak}
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 22 }}
      className={`inline-flex items-center ${gap} ${text} font-semibold text-neutral-700 dark:text-neutral-200 ${atRisk ? "animate-pulse" : ""}`}
      aria-label={atRisk ? `Streak ${streak} en péril` : `Streak ${streak}`}
    >
      <span aria-hidden>{atRisk ? "⌛" : "🔥"}</span>
      <span>{streak}</span>
    </motion.span>
  );
}
