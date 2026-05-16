"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AuthError,
  listReports,
  logout,
  type ReportSummary,
} from "@/lib/admin";

type Filter = "open" | "closed";

function initialFilter(): Filter {
  if (typeof window === "undefined") return "open";
  return new URLSearchParams(window.location.search).get("status") === "closed"
    ? "closed"
    : "open";
}

export default function AdminReportsPage() {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true);
    listReports(filter)
      .then((rs) => {
        setReports(rs);
        setErr("");
      })
      .catch((e) => {
        if (e instanceof AuthError) {
          window.location.href = "/admin/login";
          return;
        }
        setErr("Erreur de chargement");
      })
      .finally(() => setLoading(false));
  }, [filter]);

  const onLogout = async () => {
    await logout();
    window.location.href = "/admin/login";
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            Signalements
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            File de modération.
          </p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="text-xs text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          Se déconnecter
        </button>
      </header>

      <nav className="mb-6 flex gap-2">
        <Link
          href="/admin/bans"
          className="rounded-full px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
        >
          Bans
        </Link>
        {(
          [
            ["open", "À traiter"],
            ["closed", "Résolus"],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f
                ? "bg-neutral-900 text-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {loading && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Chargement…
        </p>
      )}
      {err && (
        <p className="text-sm text-red-600 dark:text-red-400">{err}</p>
      )}
      {!loading && !err && reports.length === 0 && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Rien à afficher.
        </p>
      )}

      {reports.length > 0 && (
        <div className="overflow-hidden rounded-xl bg-neutral-100/60 dark:bg-neutral-900/50">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Reporté</th>
                <th className="px-4 py-3 font-medium">Raison</th>
                <th className="px-4 py-3 font-medium">Statut</th>
                <th className="px-4 py-3 font-medium">Créé</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200/50 dark:divide-neutral-800/50">
              {reports.map((r) => (
                <tr key={r.id} className="text-neutral-700 dark:text-neutral-300">
                  <td className="px-4 py-3 font-mono text-xs">{r.id}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">
                      {r.reported_nick}
                    </span>
                    <span className="ml-1 font-mono text-[11px] text-neutral-500 dark:text-neutral-500">
                      {r.reported_fingerprint.slice(0, 8)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.reason
                      ? r.reason.length > 60
                        ? r.reason.slice(0, 60) + "…"
                        : r.reason
                      : (
                        <span className="text-neutral-400 dark:text-neutral-600">
                          —
                        </span>
                      )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500 dark:text-neutral-400">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/reports/${r.id}`}
                      className="text-xs font-medium text-neutral-700 underline-offset-2 hover:underline dark:text-neutral-300"
                    >
                      Examiner
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    open: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    resolved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    dismissed: "bg-neutral-500/15 text-neutral-600 dark:text-neutral-400",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        map[status] || ""
      }`}
    >
      {status}
    </span>
  );
}
