"use client";

import { useState } from "react";
import {
  Activity,
  Bot,
  Crown,
  Layers,
  MessagesSquare,
  Radio,
  UserPlus,
  Users,
} from "lucide-react";
import {
  fetchOverview,
  fetchTimeSeries,
  type TimeSeriesMetric,
} from "@/lib/adminStats";
import {
  Card,
  ErrorBox,
  KpiCard,
  KpiSkeleton,
  PageHeader,
  Segmented,
  useAuthedData,
} from "@/components/admin/ui";
import { LineCard } from "@/components/admin/charts";

const METRICS: { value: TimeSeriesMetric; label: string }[] = [
  { value: "signups", label: "Inscriptions" },
  { value: "active_users", label: "Actifs" },
  { value: "matches", label: "Matchs" },
  { value: "messages", label: "Messages" },
  { value: "page_views", label: "Visites" },
];

export default function OverviewPage() {
  const { data: o, loading, error } = useAuthedData(fetchOverview, []);
  const [metric, setMetric] = useState<TimeSeriesMetric>("signups");
  const series = useAuthedData(() => fetchTimeSeries(metric, "day"), [metric]);

  return (
    <div className="px-6 py-8">
      <PageHeader
        title="Vue d'ensemble"
        subtitle="État live du produit et activité récente."
      />

      {error && <ErrorBox message={error} />}
      {loading && <KpiSkeleton count={8} />}

      {o && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <KpiCard label="En ligne" value={o.online_now} hint={`${o.searching} en recherche`} icon={Radio} tone="accent" />
            <KpiCard label="Utilisateurs" value={o.total_users} hint={`+${o.new_users_24h} / 24 h`} icon={Users} />
            <KpiCard label="DAU / WAU / MAU" value={`${o.dau} / ${o.wau} / ${o.mau}`} icon={Activity} />
            <KpiCard label="Premium" value={o.premium_users} icon={Crown} tone="premium" />
            <KpiCard label="Matchs 24 h" value={o.conversations_24h} icon={MessagesSquare} />
            <KpiCard label="Humain / bot 24 h" value={`${o.human_matches_24h} / ${o.bot_matches_24h}`} hint="repli IA si file vide" icon={Bot} />
            <KpiCard label="Nouveaux 7 j" value={o.new_users_7d} icon={UserPlus} />
            <KpiCard
              label="Files actives"
              value={o.queue_depth.reduce((s, q) => s + q.count, 0)}
              hint={`${o.queue_depth.length} paires`}
              icon={Layers}
            />
          </div>

          <Card
            title="Tendance (30 j)"
            action={<Segmented value={metric} onChange={setMetric} options={METRICS} />}
          >
            {series.data ? <LineCard points={series.data} /> : <div className="h-[240px]" />}
          </Card>
        </>
      )}
    </div>
  );
}
