"use client";

import { LANG_LABEL, type LangCode } from "@/lib/langs";
import { cn } from "@/lib/cn";

const ALL_LANGS: LangCode[] = ["fr", "en", "es", "de"];

interface Props {
  value: LangCode | null;
  onChange: (code: LangCode) => void;
  /**
   * Langue(s) à griser. Accepte un code unique (cas "ne pas choisir la
   * même des deux côtés") ou une liste (cas "paires non ouvertes").
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
              "rounded-lg border px-3 py-2.5 text-center text-sm font-medium transition-colors",
              selected
                ? "border-white/20 bg-white text-neutral-950"
                : disabled
                  ? "cursor-not-allowed border-neutral-800/40 bg-neutral-900/20 text-neutral-700"
                  : "border-neutral-800 bg-neutral-900/40 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800/60",
            )}
          >
            {LANG_LABEL[code]}
          </button>
        );
      })}
    </div>
  );
}
