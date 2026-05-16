"use client";

import { useT } from "@/lib/i18n";

interface Props {
  value: boolean;
  onChange: (v: boolean) => void;
}

export function AgeGate({ value, onChange }: Props) {
  const t = useT();
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm text-neutral-700 dark:text-neutral-300">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 cursor-pointer accent-neutral-900 dark:accent-neutral-50"
      />
      <span>{t.setup.ageGate}</span>
    </label>
  );
}
