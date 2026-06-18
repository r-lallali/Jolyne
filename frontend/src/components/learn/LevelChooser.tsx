"use client";

import { useT } from "@/lib/i18n";

// Sélecteur de niveau affiché à la première entrée dans un cours (avant le
// parcours). Le niveau choisi détermine l'unité de départ : les unités
// antérieures sont marquées comme acquises (on ne propose pas les premières
// leçons à quelqu'un qui a déjà des bases). Tout reste révisable.
export function LevelChooser({
  unitCount,
  busy,
  onChoose,
}: {
  unitCount: number;
  busy: boolean;
  onChoose: (startUnit: number) => void;
}) {
  const t = useT();

  // Niveaux nommés → unité de départ, dédupliqués et bornés au nombre d'unités.
  const raw = [
    { label: t.learn.levelBeginner, unit: 0 },
    { label: t.learn.levelBasics, unit: 1 },
    { label: t.learn.levelIntermediate, unit: Math.floor(unitCount / 2) },
    { label: t.learn.levelAdvanced, unit: unitCount - 1 },
  ].filter((o) => o.unit >= 0 && o.unit < unitCount);
  const seen = new Set<number>();
  const options = raw.filter((o) => {
    if (seen.has(o.unit)) return false;
    seen.add(o.unit);
    return true;
  });

  return (
    <div className="mx-auto mt-10 max-w-md text-center">
      <div className="text-5xl">🎚️</div>
      <h2 className="mt-4 text-xl font-bold text-neutral-900 dark:text-neutral-50">
        {t.learn.chooseLevel}
      </h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        {t.learn.levelHint}
      </p>
      <div className="mt-6 flex flex-col gap-2">
        {options.map((o) => (
          <button
            key={o.unit}
            type="button"
            disabled={busy}
            onClick={() => onChoose(o.unit)}
            className="rounded-2xl border-2 border-neutral-200 px-4 py-3 text-left text-base font-medium text-neutral-900 transition-colors hover:border-emerald-400 hover:bg-emerald-50/40 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-50 dark:hover:border-emerald-500/50 dark:hover:bg-emerald-500/5"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
