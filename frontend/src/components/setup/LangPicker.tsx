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
              "rounded-md border px-3 py-2 text-sm transition-colors",
              selected
                ? "border-neutral-100 bg-neutral-100 text-neutral-950"
                : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:bg-neutral-800",
            )}
          >
            {LANG_LABEL[p.speaks]} → {LANG_LABEL[p.wants]}
          </button>
        );
      })}
    </div>
  );
}
