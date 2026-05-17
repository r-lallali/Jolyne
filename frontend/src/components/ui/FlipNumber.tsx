"use client";

import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";

interface Props {
  value: number;
  className?: string;
}

// Compteur "scoreboard" style volleyball : chaque chiffre flippe
// indépendamment quand sa valeur change (slide vertical). On garde
// l'identité React du <FlipDigit> par position+longueur pour qu'un
// changement de valeur sur place déclenche l'AnimatePresence interne,
// et qu'un changement de longueur (9 → 10) ne fasse pas tout repop.
export function FlipNumber({ value, className }: Props) {
  const digits = String(Math.max(0, Math.floor(value)));
  return (
    <span
      className={cn(
        "inline-flex items-center tabular-nums leading-none",
        className,
      )}
    >
      {digits.split("").map((d, i) => (
        <FlipDigit key={`${digits.length}-${i}`} value={d} />
      ))}
    </span>
  );
}

function FlipDigit({ value }: { value: string }) {
  return (
    <span
      className="relative inline-block overflow-hidden"
      style={{ width: "0.62em", height: "1em" }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={{ y: "-100%", opacity: 0 }}
          transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
          className="absolute inset-0 flex items-center justify-center"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
