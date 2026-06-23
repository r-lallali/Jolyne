"use client";

import { useState } from "react";
import {
  fetchOverview,
  fetchTimeSeries,
  type TimeSeriesMetric,
} from "@/lib/adminStats";
import {
  Card,
  ErrorBox,
  KpiCard,
  PageHeader,
  Spinner,
  useAuthedData,
} from "@/components/admin/ui";
import { LineCard } from "@/components/admin/charts";

const METRICS: { key: TimeSeriesMetric; label: string }[] = [
  { key: "signups", label: "Inscriptions" },
  { key: "active_users", label: "Utilisateurs actifs" },
  { key: "matches", label: "Matchs" },
  { key: "messages", label: "Messages" },
  { key: "page_views", label: "Visites" },
];

export default function OverviewPage() {
  const { data: o, loading, error } = useAuthedData(fetchOverview, []);
  const [metric, setMetric] = useState<TimeSeriesMetric>("signups");
  const series = useAuthedData(
    () => fetchTimeSeries(metric, "day"),
    [metric],
  );

  return (
    <div className="px-6 py-8">
      <PageHeader
        title="Vue d'ensemble"
        subtitle="État live du produit et activité récente."
      />

      {loading && <Spinner />}
      {error && <ErrorBox message={error} />}

      {o && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <KpiCard label="En ligne" value={o.online_now} hint={`${o.searching} en recherche`} accent />
            <KpiCard label="Utilisateurs" value={o.total_users} hint={`+${o.new_users_24h} / 24 h`} />
            <KpiCard label="DAU / WAU / MAU" value={`${o.dau} / ${o.wau} / ${o.mau}`} />
            <KpiCard label="Premium" value={o.premium_users} />
            <KpiCard label="Matchs 24 h" value={o.conversations_24h} />
            <KpiCard
              label="Humain vs bot 24 h"
              value={`${o.human_matches_24h} / ${o.bot_matches_24h}`}
              hint="repli IA quand la file est vide"
            />
            <KpiCard label="Nouveaux 7 j" value={o.new_users_7d} />
            <KpiCard
              label="Files actives"
              value={o.queue_depth.reduce((s, q) => s + q.count, 0)}
              hint={`${o.queue_depth.length} paires`}
            />
          </div>

          <Card
            title="Tendance"
            className="mt-3"
          >
            <div className="mb-3 flex flex-wrap gap-1">
              {METRICS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMetric(m.key)}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                    metric === m.key
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {series.data ? (
              <LineCard points={series.data} />
            ) : (
              <div className="h-[240px]" />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
