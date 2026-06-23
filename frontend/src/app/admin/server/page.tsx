"use client";

import { useEffect, useState } from "react";
import { fetchServer, type ServerSnapshot } from "@/lib/adminStats";
import { AuthError } from "@/lib/admin";
import {
  Card,
  ErrorBox,
  KpiCard,
  PageHeader,
  Spinner,
} from "@/components/admin/ui";

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}j ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function ServerPage() {
  const [snap, setSnap] = useState<ServerSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchServer()
        .then((s) => {
          if (!alive) return;
          setSnap(s);
          setError("");
        })
        .catch((e) => {
          if (!alive) return;
          if (e instanceof AuthError) {
            window.location.href = "/admin/login";
            return;
          }
          setError("Erreur de chargement");
        })
        .finally(() => alive && setLoading(false));
    load();
    const t = setInterval(load, 10_000); // auto-refresh 10 s
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const degraded =
    snap && Object.values(snap.health).some((v) => v === "down");

  return (
    <div className="px-6 py-8">
      <PageHeader
        title="Serveur"
        subtitle="Santé live (rafraîchi toutes les 10 s). Métriques fines : /metrics (Prometheus)."
      />

      {loading && !snap && <Spinner />}
      {error && <ErrorBox message={error} />}

      {snap && (
        <>
          <div
            className={`mb-3 rounded-lg border px-4 py-2 text-sm ${
              degraded
                ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
            }`}
          >
            {degraded ? "⚠ Service dégradé" : "✓ Tous les services opérationnels"}
            <span className="ml-3 text-xs opacity-70">
              {Object.entries(snap.health)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")}
            </span>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <KpiCard label="En ligne" value={snap.online_now} hint={`${snap.searching} en recherche`} accent />
            <KpiCard label="Uptime" value={fmtUptime(snap.uptime_sec)} />
            <KpiCard label="Goroutines" value={snap.goroutines} />
            <KpiCard label="Heap" value={`${snap.heap_alloc_mb.toFixed(1)} Mo`} hint={`${snap.num_gc} GC`} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Pool Postgres">
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                {Object.entries(snap.db_pool).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-neutral-500">{k}</dt>
                    <dd className="text-right tabular-nums text-neutral-800 dark:text-neutral-100">
                      {v}
                    </dd>
                  </div>
                ))}
                {Object.keys(snap.db_pool).length === 0 && (
                  <p className="text-neutral-400">Postgres non configuré.</p>
                )}
              </dl>
            </Card>

            <Card title="Files de matchmaking">
              {snap.queue_depth.length === 0 ? (
                <p className="text-sm text-neutral-400">Aucune file active.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {snap.queue_depth.map((q) => (
                    <li key={q.pair} className="flex justify-between">
                      <span className="text-neutral-600 dark:text-neutral-300">{q.pair}</span>
                      <span className="tabular-nums text-neutral-800 dark:text-neutral-100">{q.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
