"use client";

import { motion } from "framer-motion";
import { useRef, useState } from "react";

const MAX = 20;
const ALLOWED = /^[\p{L}\p{N}_-]*$/u;

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}

// Input invisible + spans Framer Motion ~180 ms par lettre.
// Le serveur applique la même règle de charset (CLAUDE.md règle d'or #3).
export function PseudoInput({ value, onChange, placeholder }: Props) {
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
      className="relative cursor-text select-none rounded-xl bg-neutral-100 px-4 py-6 ring-1 ring-transparent transition-all focus-within:ring-neutral-300 dark:bg-neutral-900/60 dark:focus-within:ring-neutral-700"
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
        aria-label={placeholder}
        className="absolute inset-0 w-full opacity-0"
      />
      <div className="flex min-h-[2.75rem] items-end justify-center text-4xl font-medium leading-none tracking-tight">
        {value.length === 0 ? (
          <span className="text-neutral-400 dark:text-neutral-600">
            {placeholder}
          </span>
        ) : (
          Array.from(value).map((char, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 10, scale: 0.7 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="text-neutral-900 dark:text-neutral-50"
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
            className="ml-0.5 inline-block h-8 w-px bg-neutral-700 dark:bg-neutral-200"
          />
        )}
      </div>
    </div>
  );
}
