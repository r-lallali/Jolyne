"use client";

import { fetchAudit } from "@/lib/adminStats";
import {
  Card,
  ErrorBox,
  PageHeader,
  Spinner,
  useAuthedData,
} from "@/components/admin/ui";

export default function AuditPage() {
  const { data: entries, loading, error } = useAuthedData(
    () => fetchAudit(200, 0),
    [],
  );

  return (
    <div className="px-6 py-8">
      <PageHeader
        title="Journal d'audit"
        subtitle="Toutes les actions admin (résolutions, bans, changements de plan, suppressions RGPD)."
      />

      {loading && <Spinner />}
      {error && <ErrorBox message={error} />}

      {entries && (
        <Card>
          {entries.length === 0 ? (
            <p className="text-sm text-neutral-500">Aucune action enregistrée.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-neutral-400">
                  <tr>
                    <th className="px-2 py-1.5">Date</th>
                    <th className="px-2 py-1.5">Acteur</th>
                    <th className="px-2 py-1.5">Action</th>
                    <th className="px-2 py-1.5">Cible</th>
                    <th className="px-2 py-1.5">Motif</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr
                      key={i}
                      className="border-t border-neutral-100 dark:border-neutral-800"
                    >
                      <td className="whitespace-nowrap px-2 py-1.5 text-neutral-500">
                        {new Date(e.created_at).toLocaleString("fr-FR")}
                      </td>
                      <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-300">{e.actor}</td>
                      <td className="px-2 py-1.5">
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                          {e.action}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-neutral-500">
                        {e.target_type}:{e.target_value}
                      </td>
                      <td className="px-2 py-1.5 text-neutral-500">{e.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
