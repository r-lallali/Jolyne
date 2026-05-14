"use client";

import { motion } from "framer-motion";
import { useRef, useState } from "react";

const MAX = 20;
// Lettres, chiffres, tiret, underscore. Le serveur applique la même règle
// (CLAUDE.md règle d'or #3) — le filtrage UI n'est qu'une aide ergonomique.
const ALLOWED = /^[\p{L}\p{N}_-]*$/u;

interface Props {
  value: string;
  onChange: (v: string) => void;
}

// PseudoInput affiche la saisie en cours avec une animation lettre-par-lettre
// (Framer Motion, ~180 ms). Un input natif invisible capte la frappe et
// reste accessible (autofill, paste, lecteurs d'écran).
//
// L'animation ne bloque jamais l'utilisateur (CLAUDE.md §Animation).
export function PseudoInput({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value.slice(0, MAX);
    if (!ALLOWED.test(next)) return;
    onChange(next);
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className="relative cursor-text select-none rounded-xl border border-neutral-700/50 bg-neutral-950/60 px-4 py-6 transition-colors focus-within:border-neutral-600 hover:border-neutral-600"
    >
      <input
        ref={inputRef}
        value={value}
        onChange={handle}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        maxLength={MAX}
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Pseudo"
        className="absolute inset-0 w-full opacity-0"
      />
      <div className="flex min-h-[2.75rem] items-end justify-center text-4xl font-medium leading-none tracking-tight">
        {value.length === 0 ? (
          <span className="text-neutral-600">ton pseudo</span>
        ) : (
          Array.from(value).map((char, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 10, scale: 0.7 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="text-neutral-50"
            >
              {char}
            </motion.span>
          ))
        )}
        {focused && (
          <motion.span
            aria-hidden
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="ml-0.5 inline-block h-8 w-px bg-neutral-200"
          />
        )}
      </div>
    </div>
  );
}
