"use client";

import { ALL_LANGS, LANG_FLAG, LANG_LABEL, type LangCode } from "@/lib/langs";
import { cn } from "@/lib/cn";

interface Props {
  value: LangCode | null;
  onChange: (code: LangCode) => void;
  /**
   * Langue(s) à griser. Accepte un code unique ou une liste.
   */
  exclude?: LangCode | readonly LangCode[] | null;
}

export function LangSelector({ value, onChange, exclude }: Props) {
  const excludeSet = new Set<LangCode>(
    exclude == null ? [] : typeof exclude === "string" ? [exclude] : exclude,
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
              "flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-center text-sm font-medium transition-colors",
              selected
                ? "bg-neutral-900 text-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
                : disabled
                  ? "cursor-not-allowed bg-neutral-100/50 text-neutral-400 dark:bg-neutral-900/30 dark:text-neutral-700"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-900/60 dark:text-neutral-300 dark:hover:bg-neutral-800",
            )}
          >
            <span aria-hidden className={cn("text-base", disabled && "grayscale")}>
              {LANG_FLAG[code]}
            </span>
            <span>{LANG_LABEL[code]}</span>
          </button>
        );
      })}
    </div>
  );
}
