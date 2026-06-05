"use client";

import { motion } from "framer-motion";

// StreakBadge : emoji + compteur, sans fond coloré. N'affiche rien tant
// que streak < 2.
// Variantes :
//   - normal  : 🔥 N
//   - at-risk : ⌛ N (sablier statique pour signaler le risque)
//
// La restauration d'un streak perdu n'est plus exposée ici (pas de badge
// 💔 à côté du nom) : elle passe par le StreakLostBanner dans le flux du
// chat.

interface Props {
  streak: number;
  atRisk: boolean;
  size?: "sm" | "md";
}

export function StreakBadge({ streak, atRisk, size = "sm" }: Props) {
  if (streak < 2) return null;

  const text = size === "md" ? "text-sm" : "text-xs";
  const gap = size === "md" ? "gap-1" : "gap-0.5";

  return (
    <motion.span
      key={streak}
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 22 }}
      className={`inline-flex items-center ${gap} ${text} font-semibold text-neutral-700 dark:text-neutral-200`}
      aria-label={atRisk ? `Streak ${streak} en péril` : `Streak ${streak}`}
    >
      <span aria-hidden>{atRisk ? "⌛" : "🔥"}</span>
      <span>{streak}</span>
    </motion.span>
  );
}
