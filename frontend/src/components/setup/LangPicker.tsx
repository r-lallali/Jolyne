"use client";

import { ALLOWED_PAIRS, LANG_LABEL, type LangPair } from "@/lib/langs";
import { cn } from "@/lib/cn";

interface Props {
  value: LangPair | null;
  onChange: (p: LangPair) => void;
}

export function LangPicker({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {ALLOWED_PAIRS.map((p) => {
        const selected =
          value?.speaks === p.speaks && value?.wants === p.wants;
        return (
          <button
            key={`${p.speaks}-${p.wants}`}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
              selected
                ? "border-neutral-100 bg-neutral-50 text-neutral-950"
                : "border-neutral-800 bg-neutral-900/40 text-neutral-200 hover:border-neutral-700 hover:bg-neutral-900",
            )}
          >
            <span className="font-medium">{LANG_LABEL[p.speaks]}</span>
            <span
              className={cn(
                "mx-1.5",
                selected ? "text-neutral-500" : "text-neutral-600",
              )}
            >
              →
            </span>
            <span
              className={cn(selected ? "text-neutral-700" : "text-neutral-400")}
            >
              {LANG_LABEL[p.wants]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
