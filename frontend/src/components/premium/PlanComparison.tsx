"use client";

import { useT } from "@/lib/i18n";

// Avantages Premium : une ligne par fonctionnalité, limite Free → valeur
// Premium. La flèche porte la transformation — plus lisible qu'un tableau
// à colonnes pour cinq lignes. Réutilisé par la modale paywall.
export function PlanComparison() {
  const t = useT();

  const rows = [
    {
      label: t.premium.featureTranslations,
      free: t.premium.perDay({ n: 10 }),
      premium: t.premium.unlimited,
    },
    {
      label: t.premium.featurePartners,
      free: t.premium.perDay({ n: 10 }),
      premium: t.premium.unlimited,
    },
    {
      label: t.premium.featureBot,
      free: t.premium.perDay({ n: 50 }),
      premium: t.premium.unlimited,
    },
    {
      label: t.premium.featureScenarios,
      free: "2 / 5",
      premium: t.premium.allScenarios,
    },
    {
      label: t.premium.featureHearts,
      free: "5",
      premium: t.premium.unlimited,
    },
  ];

  return (
    <ul className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200 px-4 dark:divide-neutral-900 dark:border-neutral-800">
      {rows.map((row) => (
        <li
          key={row.label}
          className="flex items-center justify-between gap-3 py-2.5"
        >
          <span className="text-sm text-neutral-700 dark:text-neutral-300">
            {row.label}
          </span>
          <span className="flex items-center gap-1.5 whitespace-nowrap tabular-nums">
            <span className="text-xs text-neutral-400 dark:text-neutral-500">
              {row.free}
            </span>
            <ArrowRight />
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
              {row.premium}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ArrowRight() {
  return (
    <svg
      className="size-3 shrink-0 text-neutral-300 dark:text-neutral-700"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}
