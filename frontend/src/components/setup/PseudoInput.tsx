"use client";

import { motion } from "framer-motion";
import { useRef } from "react";

const MAX = 20;
// Lettres, chiffres, tiret, underscore. Espaces interdits côté UI — le
// serveur applique la même règle (CLAUDE.md règle d'or #3).
const ALLOWED = /^[\p{L}\p{N}_-]*$/u;

interface Props {
  value: string;
  onChange: (v: string) => void;
}

// PseudoInput affiche le pseudo en cours de saisie avec une animation
// lettre-par-lettre (Framer Motion). Un input natif invisible capte la
// frappe et reste accessible (autofill, paste, lecteurs d'écran).
//
// L'animation ne bloque jamais l'utilisateur — la valeur est mise à jour
// synchroniquement, l'animation joue par-dessus (CLAUDE.md §"Animation").
export function PseudoInput({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value.slice(0, MAX);
    if (!ALLOWED.test(next)) return;
    onChange(next);
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className="relative cursor-text select-none"
    >
      <input
        ref={inputRef}
        value={value}
        onChange={handle}
        maxLength={MAX}
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Pseudo"
        className="absolute inset-0 w-full opacity-0"
      />
      <div className="flex min-h-[3rem] items-end justify-center text-4xl font-medium leading-none tracking-tight">
        {value.length === 0 ? (
          <span className="text-neutral-700">choisis un pseudo</span>
        ) : (
          Array.from(value).map((char, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 10, scale: 0.7 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {char}
            </motion.span>
          ))
        )}
        <motion.span
          aria-hidden
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="ml-0.5 inline-block h-9 w-px bg-neutral-100"
        />
      </div>
    </div>
  );
}
