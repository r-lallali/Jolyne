"use client";

import { Fragment } from "react";
import { useT } from "@/lib/i18n";

// PlanComparison : tableau comparatif Gratuit vs Premium. Réutilisé par la
// modale paywall et la section abonnement de /account. `currentPlan` met en
// avant l'offre actuelle de l'utilisateur via un badge sous l'en-tête de la
// bonne colonne. Le premium est illimité (∞) sur toutes les lignes ; seules
// les limites quotidiennes du plan gratuit varient.
export function PlanComparison({
  currentPlan,
}: {
  currentPlan?: "free" | "premium";
}) {
  const t = useT();

  const rows = [
    { label: t.premium.featurePartners, free: 10 },
    { label: t.premium.featureTranslations, free: 10 },
    { label: t.premium.featureBot, free: 50 },
  ];

  const labelCell =
    "border-t border-neutral-200 px-4 py-3 text-sm text-neutral-700 dark:border-neutral-800 dark:text-neutral-300";
  const freeCell =
    "border-t border-neutral-200 py-3 text-center text-sm tabular-nums text-neutral-500 dark:border-neutral-800 dark:text-neutral-400";
  const premiumCell =
    "border-t border-neutral-200 bg-neutral-100/70 py-3 text-center text-base font-semibold text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50";

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
      <div className="grid grid-cols-[1fr_4rem_5rem]">
        {/* En-tête : libellé de période + nom des deux colonnes. La colonne
            Premium est mise en valeur par un fond léger continu jusqu'en bas. */}
        <div className="px-4 pb-2 pt-3 text-[11px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
          {t.premium.compareDaily}
        </div>
        <div className="pb-2 pt-3 text-center">
          <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
            {t.premium.planFree}
          </span>
          {currentPlan === "free" && (
            <CurrentBadge label={t.premium.currentPlanBadge} />
          )}
        </div>
        <div className="bg-neutral-100/70 pb-2 pt-3 text-center dark:bg-neutral-900">
          <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-50">
            {t.premium.planPremium} ✨
          </span>
          {currentPlan === "premium" && (
            <CurrentBadge label={t.premium.currentPlanBadge} />
          )}
        </div>

        {/* Une ligne par fonctionnalité : libellé · limite gratuite · ∞. */}
        {rows.map((row) => (
          <Fragment key={row.label}>
            <div className={labelCell}>{row.label}</div>
            <div className={freeCell}>{row.free}</div>
            <div className={premiumCell} aria-label={t.premium.unlimited}>
              ∞
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function CurrentBadge({ label }: { label: string }) {
  return (
    <span className="mt-1 block text-[9px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
      {label}
    </span>
  );
}
