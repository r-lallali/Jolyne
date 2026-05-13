"use client";

interface Props {
  value: boolean;
  onChange: (v: boolean) => void;
}

export function AgeGate({ value, onChange }: Props) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm text-neutral-400">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-neutral-100"
      />
      <span>
        J&apos;ai 16 ans ou plus et j&apos;accepte de discuter avec un inconnu.
      </span>
    </label>
  );
}
