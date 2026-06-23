"use client";

import { useState } from "react";
import { fetchRetention } from "@/lib/adminStats";
import {
  Card,
  ErrorBox,
  PageHeader,
  Segmented,
  Skeleton,
  useAuthedData,
} from "@/components/admin/ui";

// Couleur de cellule selon le taux de rétention (0→1).
function cellColor(rate: number): string {
  if (rate <= 0) return "bg-neutral-100 dark:bg-neutral-800/40";
  const buckets = [
    [0.05, "bg-emerald-100 dark:bg-emerald-950/50"],
    [0.15, "bg-emerald-200 dark:bg-emerald-900/60"],
    [0.3, "bg-emerald-300 dark:bg-emerald-800/70"],
    [0.5, "bg-emerald-400 dark:bg-emerald-700"],
    [1.01, "bg-emerald-500 dark:bg-emerald-600"],
  ] as const;
  for (const [max, cls] of buckets) if (rate < max) return cls;
  return "bg-emerald-500";
}

export default function RetentionPage() {
  const [cohort, setCohort] = useState<"weekly" | "daily">("weekly");
  const { data, loading, error } = useAuthedData(
    () => fetchRetention(cohort),
    [cohort],
  );

  const maxOffset = data
    ? Math.max(
        0,
        ...data.cohorts.flatMap((c) =>
          Object.keys(c.values).map((k) => Number(k)),
        ),
      )
    : 0;
  const offsets = Array.from({ length: maxOffset + 1 }, (_, i) => i);
  const unit = cohort === "weekly" ? "S" : "J";

  return (
    <div className="px-6 py-8">
      <PageHeader
        title="Rétention par cohorte"
        subtitle="Part des inscrits encore actifs N périodes après leur inscription."
        actions={
          <Segmented
            value={cohort}
            onChange={setCohort}
            options={[
              { value: "weekly", label: "Hebdo" },
              { value: "daily", label: "Quotidien" },
            ]}
          />
        }
      />

      {error && <ErrorBox message={error} />}
      {loading && <Skeleton className="h-72" />}

      {data && data.cohorts.length === 0 && (
        <Card>
          <p className="text-sm text-neutral-500">
            Pas encore assez de données — les cohortes apparaîtront dès les
            premières inscriptions.
          </p>
        </Card>
      )}

      {data && data.cohorts.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-xs">
              <thead>
                <tr className="text-neutral-400">
                  <th className="px-2 py-1 text-left font-medium">Cohorte</th>
                  <th className="px-2 py-1 text-right font-medium">Taille</th>
                  {offsets.map((o) => (
                    <th key={o} className="px-2 py-1 text-center font-medium">
                      {unit}
                      {o}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.cohorts.map((c) => (
                  <tr key={c.cohort}>
                    <td className="whitespace-nowrap px-2 py-1 text-neutral-600 dark:text-neutral-300">
                      {c.cohort}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-neutral-500">
                      {c.size}
                    </td>
                    {offsets.map((o) => {
                      const rate = c.rates[String(o)] ?? 0;
                      const val = c.values[String(o)] ?? 0;
                      return (
                        <td
                          key={o}
                          className={`rounded px-2 py-1 text-center tabular-nums text-neutral-700 dark:text-neutral-100 ${cellColor(rate)}`}
                          title={`${val} actifs`}
                        >
                          {rate > 0 ? `${(rate * 100).toFixed(0)}%` : "·"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
