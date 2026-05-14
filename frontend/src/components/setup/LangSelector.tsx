"use client";

import { LANG_LABEL, type LangCode } from "@/lib/langs";
import { cn } from "@/lib/cn";

const ALL_LANGS: LangCode[] = ["fr", "en", "es", "de"];

interface Props {
  value: LangCode | null;
  onChange: (code: LangCode) => void;
  /**
   * Langue(s) à griser. Accepte un code unique ou une liste.
   */
  exclude?: LangCode | LangCode[] | null;
}

export function LangSelector({ value, onChange, exclude }: Props) {
  const excludeSet = new Set<LangCode>(
    exclude == null ? [] : Array.isArray(exclude) ? exclude : [exclude],
  );
  return (
    <div className="grid grid-cols-2 gap-2">
      {ALL_LANGS.map((code) => {
        const selected = value === code;
        const disabled = excludeSet.has(code);
        return (
          <button
            key={code}
            type="button"
            onClick={() => !disabled && onChange(code)}
            disabled={disabled}
            className={cn(
              "rounded-xl px-3 py-2.5 text-center text-sm font-medium transition-colors",
              selected
                ? "bg-neutral-900 text-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
                : disabled
                  ? "cursor-not-allowed bg-neutral-100/50 text-neutral-400 dark:bg-neutral-900/30 dark:text-neutral-700"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-900/60 dark:text-neutral-300 dark:hover:bg-neutral-800",
            )}
          >
            {LANG_LABEL[code]}
          </button>
        );
      })}
    </div>
  );
}
