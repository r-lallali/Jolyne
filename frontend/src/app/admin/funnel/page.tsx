"use client";

import { useState } from "react";
import { fetchFunnel, statsURL } from "@/lib/adminStats";
import {
  Card,
  CsvLink,
  ErrorBox,
  PageHeader,
  RangePicker,
  Skeleton,
  rangeFromDays,
  useAuthedData,
} from "@/components/admin/ui";

export default function FunnelPage() {
  const [days, setDays] = useState(30);
  const { from, to } = rangeFromDays(days);
  const { data: stages, loading, error } = useAuthedData(
    () => fetchFunnel(from, to),
    [days],
  );

  const top = stages && stages.length > 0 ? (stages[0]?.count ?? 0) : 0;

  return (
    <div className="px-6 py-8">
      <PageHeader
        title="Funnel"
        subtitle="De la première visite anonyme jusqu'au premium — où décrochent les gens."
        actions={
          <>
            <RangePicker days={days} onChange={setDays} />
            <CsvLink href={statsURL(`/api/admin/stats/funnel?from=${from}&to=${to}&format=csv`)} />
          </>
        }
      />

      {error && <ErrorBox message={error} />}
      {loading && <Skeleton className="h-72" />}

      {stages && (
        <Card>
          <div className="space-y-2">
            {stages.map((s, i) => {
              const prev = i > 0 ? (stages[i - 1]?.count ?? s.count) : s.count;
              const widthPct = top > 0 ? (s.count / top) * 100 : 0;
              const dropPct =
                i > 0 && prev > 0 ? ((prev - s.count) / prev) * 100 : 0;
              const convPct = prev > 0 ? (s.count / prev) * 100 : 100;
              return (
                <div key={s.key}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium text-neutral-800 dark:text-neutral-100">
                      {s.label}
                    </span>
                    <span className="tabular-nums text-neutral-500">
                      {s.count.toLocaleString()}
                      {i > 0 && (
                        <span
                          className={`ml-2 text-xs ${
                            dropPct > 50 ? "text-red-500" : "text-neutral-400"
                          }`}
                        >
                          {convPct.toFixed(0)}% ↦ (−{dropPct.toFixed(0)}%)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-7 overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800">
                    <div
                      className="h-full rounded-md bg-gradient-to-r from-emerald-500 to-emerald-400"
                      style={{ width: `${Math.max(widthPct, 1.5)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-neutral-400">
            Les étages visiteurs (anonymes, par empreinte) et comptes (par
            user_id) ne sont pas parfaitement reliés — le passage anonyme →
            inscrit est une approximation.
          </p>
        </Card>
      )}
    </div>
  );
}
