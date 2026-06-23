"use client";

import { useState } from "react";
import { Bot, Clock, MessageCircle, MessagesSquare, Zap } from "lucide-react";
import { fetchEngagement } from "@/lib/adminStats";
import {
  Card,
  ErrorBox,
  KpiCard,
  KpiSkeleton,
  PageHeader,
  RangePicker,
  rangeFromDays,
  useAuthedData,
} from "@/components/admin/ui";
import { BarCard } from "@/components/admin/charts";

function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} s`;
  return `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`;
}

export default function EngagementPage() {
  const [days, setDays] = useState(30);
  const { from, to } = rangeFromDays(days);
  const { data: e, loading, error } = useAuthedData(
    () => fetchEngagement(from, to),
    [days],
  );

  return (
    <div className="px-6 py-8">
      <PageHeader
        title="Engagement"
        subtitle="Qualité des conversations et part de repli sur le tuteur IA."
        actions={<RangePicker days={days} onChange={setDays} />}
      />

      {error && <ErrorBox message={error} />}
      {loading && <KpiSkeleton count={5} />}

      {e && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard label="Matchs" value={e.matches} icon={MessagesSquare} />
            <KpiCard label="Messages" value={e.messages} icon={MessageCircle} />
            <KpiCard label="Conversations finies" value={e.conversations_ended} icon={Zap} />
            <KpiCard label="Durée moyenne" value={fmtDuration(e.avg_duration_sec)} icon={Clock} />
            <KpiCard
              label="Repli IA"
              value={`${(e.bot_fallback_pct * 100).toFixed(0)}%`}
              hint="matchs servis par un bot"
              icon={Bot}
              tone={e.bot_fallback_pct > 0.5 ? "danger" : "default"}
            />
          </div>

          <Card title="Paires de langues les plus demandées">
            {e.lang_pairs.length === 0 ? (
              <p className="text-sm text-neutral-500">Aucun match sur la période.</p>
            ) : (
              <BarCard
                data={e.lang_pairs.map((p) => ({ label: p.pair, value: p.count }))}
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
