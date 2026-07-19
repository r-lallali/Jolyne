"use client";

import type { CSSProperties } from "react";
import { useT } from "@/lib/i18n";

// Répartition transparente de l'abonnement : barre empilée + légende
// chiffrée. Parts estimées sur les coûts réels (API Claude, VPS, commission
// Stripe, temps de développement) — à réviser si la structure de coûts
// change : c'est un engagement d'honnêteté affiché aux utilisateurs.
//
// Palette catégorielle validée (paires adjacentes, light ET dark) contre
// les surfaces de la modale via le validateur dataviz ; l'identité n'est
// jamais portée par la couleur seule (légende label + % en texte).
const SEGMENTS = [
  { key: "costAI", pct: 45, light: "#2a78d6", dark: "#3987e5" },
  { key: "costInfra", pct: 25, light: "#008300", dark: "#008300" },
  { key: "costFees", pct: 5, light: "#e87ba4", dark: "#d55181" },
  { key: "costDev", pct: 25, light: "#eda100", dark: "#c98500" },
] as const;

// Les deux teintes voyagent en variables CSS ; la classe `dark:` fait la
// bascule — une seule barre rendue, pas de duplication light/dark.
function segStyle(s: (typeof SEGMENTS)[number], grow?: number): CSSProperties {
  return {
    ...(grow !== undefined ? { flexGrow: grow } : {}),
    "--seg": s.light,
    "--seg-dark": s.dark,
  } as CSSProperties;
}

const segClass = "bg-[var(--seg)] dark:bg-[var(--seg-dark)]";

export function CostBreakdown() {
  const t = useT();
  const label = (key: (typeof SEGMENTS)[number]["key"]) => t.premium[key];

  return (
    <div>
      {/* Barre empilée : gaps de 2px (la surface respire entre les parts),
          extrémités arrondies par le conteneur. */}
      <div
        role="img"
        aria-label={SEGMENTS.map((s) => `${label(s.key)} ${s.pct}%`).join(", ")}
        className="flex h-2 gap-0.5 overflow-hidden rounded-full"
      >
        {SEGMENTS.map((s) => (
          <span
            key={s.key}
            style={segStyle(s, s.pct)}
            title={`${label(s.key)} — ${s.pct} %`}
            className={segClass}
          />
        ))}
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {SEGMENTS.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-xs">
            <span
              aria-hidden
              style={segStyle(s)}
              className={`size-2 shrink-0 rounded-full ${segClass}`}
            />
            <span className="truncate text-neutral-600 dark:text-neutral-400">
              {label(s.key)}
            </span>
            <span className="ml-auto font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
              {s.pct} %
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
