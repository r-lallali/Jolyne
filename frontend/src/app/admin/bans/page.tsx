"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthError, listBans, liftBan, type Ban } from "@/lib/admin";

export default function AdminBansPage() {
  const [bans, setBans] = useState<Ban[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = () => {
    setLoading(true);
    listBans()
      .then((b) => {
        setBans(b);
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
  };

  useEffect(load, []);

  const onLift = async (id: number) => {
    if (!confirm("Lever ce bannissement immédiatement ?")) return;
    try {
      await liftBan(id);
      load();
    } catch {
      setErr("Échec de la levée");
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            Bannissements actifs
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Bans non expirés. Les bans levés ou expirés restent en DB pour
            traçabilité mais ne sont plus en vigueur.
          </p>
        </div>
        <Link
          href="/admin/reports"
          className="text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          ← Signalements
        </Link>
      </header>

      {loading && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Chargement…
        </p>
      )}
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      {!loading && !err && bans.length === 0 && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Aucun bannissement actif.
        </p>
      )}

      {bans.length > 0 && (
        <div className="overflow-hidden rounded-xl bg-neutral-100/60 dark:bg-neutral-900/50">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium">Axe</th>
                <th className="px-4 py-3 font-medium">Valeur</th>
                <th className="px-4 py-3 font-medium">Raison</th>
                <th className="px-4 py-3 font-medium">Par</th>
                <th className="px-4 py-3 font-medium">Expire</th>
                <th className="px-4 py-3 font-medium">Report</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200/50 dark:divide-neutral-800/50">
              {bans.map((b) => (
                <tr key={b.ID} className="text-neutral-700 dark:text-neutral-300">
                  <td className="px-4 py-3 text-xs">
                    <AxisBadge axis={b.TargetType} />
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-neutral-500 dark:text-neutral-500">
                    {b.TargetValue.length > 16
                      ? b.TargetValue.slice(0, 16) + "…"
                      : b.TargetValue}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {b.Reason || (
                      <span className="text-neutral-400 dark:text-neutral-600">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">{b.BannedBy}</td>
                  <td className="px-4 py-3 text-xs">
                    {b.ExpiresAt ? (
                      new Date(b.ExpiresAt).toLocaleString()
                    ) : (
                      <span className="font-medium text-red-600 dark:text-red-400">
                        permanent
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {b.RelatedReportID ? (
                      <Link
                        href={`/admin/reports/${b.RelatedReportID}`}
                        className="font-mono text-neutral-700 underline-offset-2 hover:underline dark:text-neutral-300"
                      >
                        #{b.RelatedReportID}
                      </Link>
                    ) : (
                      <span className="text-neutral-400 dark:text-neutral-600">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onLift(b.ID)}
                      className="text-xs font-medium text-amber-600 underline-offset-2 hover:underline dark:text-amber-400"
                    >
                      Lever
                    </button>
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

function AxisBadge({ axis }: { axis: "ip" | "fingerprint" | "user" }) {
  const map: Record<string, string> = {
    ip: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    fingerprint: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    user: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${map[axis] || ""}`}
    >
      {axis}
    </span>
  );
}
