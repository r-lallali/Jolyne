"use client";

import { use, useState } from "react";
import Link from "next/link";
import { Activity, Crown, MessageCircle, MessagesSquare } from "lucide-react";
import {
  banUser,
  deleteUser,
  fetchUser,
  setUserPremium,
  statsURL,
  type UserDetail,
} from "@/lib/adminStats";
import {
  Card,
  ErrorBox,
  KpiCard,
  PageHeader,
  Spinner,
  useAuthedData,
} from "@/components/admin/ui";

export default function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const userID = Number(id);
  const [reload, setReload] = useState(0);
  const { data: u, loading, error } = useAuthedData<UserDetail | null>(
    () => fetchUser(userID),
    [userID, reload],
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const refresh = () => setReload((n) => n + 1);

  const togglePremium = async (grant: boolean) => {
    setBusy(true);
    try {
      await setUserPremium(userID, grant);
      setMsg(grant ? "Premium accordé." : "Premium retiré.");
      refresh();
    } catch {
      setMsg("Échec de l'opération.");
    } finally {
      setBusy(false);
    }
  };

  const doBan = async () => {
    const duration = window.prompt("Durée du ban : 24h / 7d / 30d / permanent", "permanent");
    if (!duration) return;
    setBusy(true);
    try {
      await banUser(userID, duration, "ban admin depuis la fiche");
      setMsg("Ban enregistré.");
      refresh();
    } catch {
      setMsg("Échec du ban.");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!window.confirm("Supprimer définitivement ce compte et toutes ses données (RGPD) ?")) return;
    setBusy(true);
    try {
      await deleteUser(userID);
      window.location.href = "/admin/users";
    } catch {
      setMsg("Échec de la suppression.");
      setBusy(false);
    }
  };

  return (
    <div className="px-6 py-8">
      <PageHeader
        title={u ? u.email : `Utilisateur ${id}`}
        subtitle={
          <Link href="/admin/users" className="hover:underline">
            ← Retour aux utilisateurs
          </Link>
        }
      />

      {loading && <Spinner />}
      {error && <ErrorBox message={error} />}

      {u && (
        <>
          {msg && (
            <div className="mb-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
              {msg}
            </div>
          )}

          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Plan" value={u.plan} icon={Crown} tone={u.plan === "premium" ? "premium" : "default"} />
            <KpiCard label="Conversations" value={u.conversations} icon={MessagesSquare} />
            <KpiCard label="Messages" value={u.messages} icon={MessageCircle} />
            <KpiCard label="Events" value={u.total_events} icon={Activity} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Profil">
              <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-neutral-500">ID</dt>
                <dd className="text-right tabular-nums">{u.id}</dd>
                <dt className="text-neutral-500">Email vérifié</dt>
                <dd className="text-right">{u.verified ? "oui" : "non"}</dd>
                <dt className="text-neutral-500">Inscrit</dt>
                <dd className="text-right">{new Date(u.created_at).toLocaleString("fr-FR")}</dd>
                <dt className="text-neutral-500">Vu pour la dernière fois</dt>
                <dd className="text-right">
                  {u.last_seen_at ? new Date(u.last_seen_at).toLocaleString("fr-FR") : "—"}
                </dd>
                <dt className="text-neutral-500">Abonnement Stripe</dt>
                <dd className="text-right">{u.subscription_status || "—"}</dd>
                <dt className="text-neutral-500">Banni</dt>
                <dd className="text-right">{u.banned ? "⚠ oui" : "non"}</dd>
              </dl>
            </Card>

            <Card title="Actions">
              <div className="flex flex-wrap gap-2">
                {u.plan === "premium" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => togglePremium(false)}
                    className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                  >
                    Retirer Premium
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => togglePremium(true)}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                  >
                    Offrir Premium
                  </button>
                )}
                <a
                  href={statsURL(`/api/admin/stats/users/${userID}/data`)}
                  className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                >
                  Export RGPD
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={doBan}
                  className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                >
                  Bannir
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={doDelete}
                  className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                >
                  Supprimer (RGPD)
                </button>
              </div>
              <p className="mt-3 text-xs text-neutral-400">
                « Offrir Premium » est un override admin (Stripe reste la source
                de vérité). La suppression est irréversible et purge toutes les
                données liées.
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
