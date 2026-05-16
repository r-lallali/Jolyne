"use client";

import { motion } from "framer-motion";
import { useT } from "@/lib/i18n";
import type { GrammarMatch } from "@/lib/grammar";

interface Props {
  text: string;
  matches: GrammarMatch[];
  onApply: (matchIndex: number, replacement: string) => void;
  onClose: () => void;
}

// Popover affiché au-dessus de l'input quand le user clique "Corriger".
// Une carte par faute, suggestions cliquables. Pas de mise en surbrillance
// inline pour rester simple — on affiche la zone fautive en code.
export function GrammarPopover({ text, matches, onApply, onClose }: Props) {
  const t = useT();
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.15 }}
      className="mx-auto w-full max-w-2xl rounded-2xl border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {matches.length === 0
            ? t.grammar.nothingToFix
            : t.grammar.suggestionsCount({ count: matches.length })}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.grammar.close}
          className="text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          {t.grammar.close}
        </button>
      </div>

      {matches.length === 0 ? (
        <p className="py-2 text-sm text-neutral-600 dark:text-neutral-400">
          {t.grammar.noErrors}
        </p>
      ) : (
        <ul className="space-y-2">
          {matches.map((m, i) => {
            const snippet = text.slice(m.offset, m.offset + m.length);
            return (
              <li
                key={i}
                className="rounded-lg bg-neutral-100 p-2.5 dark:bg-neutral-900"
              >
                <p className="text-xs text-neutral-700 dark:text-neutral-300">
                  <span className="rounded bg-red-500/15 px-1 font-mono text-[12px] text-red-700 dark:text-red-300">
                    {snippet || "—"}
                  </span>
                  <span className="ml-2">{m.message}</span>
                </p>
                {m.replacements.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {m.replacements.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => onApply(i, r)}
                        className="rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-neutral-50 hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </motion.div>
  );
}
