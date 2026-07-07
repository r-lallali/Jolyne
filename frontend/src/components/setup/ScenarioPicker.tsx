"use client";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { SCENARIOS } from "@/lib/scenarios";

interface Props {
  // Scénario sélectionné (id) — null = chat libre.
  value: string | null;
  onChange: (v: string | null) => void;
  // Compte non premium : les scénarios verrouillés ouvrent le paywall.
  isPremium: boolean;
  onLockedClick: () => void;
}

// ScenarioPicker : chips de scénarios roleplay sous le toggle Prof IA. La
// première chip « chat libre » correspond à l'absence de scénario (mode
// historique). Les scénarios non-free sont verrouillés hors Premium.
export function ScenarioPicker({ value, onChange, isPremium, onLockedClick }: Props) {
  const t = useT();
  const labels = t.scenarios as unknown as Record<
    string,
    { title: string; hint: string }
  >;
  return (
    <div className="rounded-xl bg-neutral-100 px-3 py-3 dark:bg-neutral-900/60">
      <p className="px-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
        {t.setup.scenarioLabel}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Chip
          selected={value === null}
          onClick={() => onChange(null)}
          emoji="💬"
          label={t.setup.scenarioFreeChat}
        />
        {SCENARIOS.map((s) => {
          const locked = !s.free && !isPremium;
          return (
            <Chip
              key={s.id}
              selected={value === s.id}
              locked={locked}
              onClick={() => (locked ? onLockedClick() : onChange(s.id))}
              emoji={s.emoji}
              label={labels[s.id]?.title ?? s.id}
            />
          );
        })}
      </div>
      {value !== null && labels[value]?.hint && (
        <p className="mt-2 px-1 text-xs text-neutral-500 dark:text-neutral-400">
          {labels[value].hint}
        </p>
      )}
    </div>
  );
}

function Chip({
  selected,
  locked = false,
  onClick,
  emoji,
  label,
}: {
  selected: boolean;
  locked?: boolean;
  onClick: () => void;
  emoji: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
        selected
          ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
          : locked
            ? "bg-white text-neutral-400 ring-1 ring-neutral-200 dark:bg-neutral-950 dark:text-neutral-600 dark:ring-neutral-800"
            : "bg-white text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50 dark:bg-neutral-950 dark:text-neutral-300 dark:ring-neutral-800 dark:hover:bg-neutral-900",
      )}
    >
      <span aria-hidden className={cn(locked && "grayscale")}>
        {emoji}
      </span>
      {label}
      {locked && (
        <span aria-hidden className="text-[10px]">
          🔒
        </span>
      )}
    </button>
  );
}
