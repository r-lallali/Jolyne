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
  // Plus le cours est long, plus on propose de paliers distincts.
  const raw = [
    { label: t.learn.levelBeginner, unit: 0 },
    { label: t.learn.levelBasics, unit: 1 },
    { label: t.learn.levelElementary, unit: 2 },
    { label: t.learn.levelIntermediate, unit: Math.floor(unitCount / 2) },
    { label: t.learn.levelUpperIntermediate, unit: Math.floor((unitCount * 2) / 3) },
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
            className="group flex items-center justify-between rounded-2xl border border-neutral-200 px-4 py-3 text-left text-base font-medium text-neutral-900 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_8px_24px_-14px_rgba(0,0,0,0.25)] disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-50 dark:hover:border-neutral-700 dark:hover:shadow-[0_8px_24px_-14px_rgba(0,0,0,0.7)]"
          >
            {o.label}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
              className="size-4 -translate-x-1 text-neutral-400 opacity-0 transition-all duration-200 ease-out group-hover:translate-x-0 group-hover:opacity-100 dark:text-neutral-500"
            >
              <path
                d="M5 12h14M13 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
