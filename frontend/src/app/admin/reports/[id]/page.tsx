"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import {
  AuthError,
  banFromReport,
  getReport,
  reopenReport,
  resolveReport,
  type BanDuration,
  type ReportDetail,
  type ReportEvent,
} from "@/lib/admin";
import { BanModal } from "@/components/admin/BanModal";

export default function AdminReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = use(params);
  const id = Number(idStr);
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [banOpen, setBanOpen] = useState(false);

  const load = () => {
    setLoading(true);
    getReport(id)
      .then((r) => {
        if (!r) setErr("Introuvable");
        else setReport(r);
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

  useEffect(() => {
    if (!Number.isFinite(id)) {
      setErr("ID invalide");
      setLoading(false);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const act = async (
    action: "resolved" | "reopened",
    redirect = true,
  ) => {
    setBusy(true);
    setErr("");
    try {
      if (action === "reopened") {
        await reopenReport(id, note);
      } else {
        await resolveReport(id, note);
      }
      if (redirect) {
        window.location.href = "/admin/reports";
      } else {
        setNote("");
        load();
      }
    } catch {
      setErr("Échec de l'action");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Chargement…
        </p>
      </main>
    );
  }
  if (err || !report) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link
          href="/admin/reports"
          className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          ← Retour
        </Link>
        <p className="mt-6 text-sm text-red-600 dark:text-red-400">
          {err || "Introuvable"}
        </p>
      </main>
    );
  }

  const closed = report.status !== "open";

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/admin/reports"
        className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        ← Retour
      </Link>

      <header className="mt-6 mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          Signalement #{report.id}
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Créé le {new Date(report.created_at).toLocaleString("fr-FR")} — statut :{" "}
          <span className="font-medium">{report.status}</span>
        </p>
      </header>

      <section className="mb-8 grid gap-4 rounded-xl bg-neutral-100/60 p-5 text-sm dark:bg-neutral-900/50 sm:grid-cols-2">
        <Field
          label="Reporté"
          value={report.reported_nick}
          mono={false}
        />
        <Field label="Fingerprint" value={report.reported_fingerprint} mono />
        <Field label="Session reportée" value={report.reported_session} mono />
        <Field
          label="IP reporter (hash)"
          value={report.reporter_ip_hash}
          mono
        />
        <Field
          label="Raison initiale"
          value={report.reason || "—"}
          mono={false}
          full
        />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-500">
          Conversation capturée ({(report.messages ?? []).length})
        </h2>
        <div className="space-y-2 rounded-xl bg-neutral-100/60 p-4 dark:bg-neutral-900/50">
          {(report.messages ?? []).length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Aucun message dans la fenêtre de capture.
            </p>
          ) : (
            (report.messages ?? []).map((m, i) => (
              <div key={i} className="text-sm">
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {m.from}
                </span>
                <span className="ml-2 text-[11px] text-neutral-500 dark:text-neutral-500">
                  {new Date(m.at).toLocaleTimeString("fr-FR")}
                </span>
                <p className="whitespace-pre-wrap break-words text-neutral-700 dark:text-neutral-300">
                  {m.body}
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      {(report.history ?? []).length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-500">
            Historique des décisions ({(report.history ?? []).length})
          </h2>
          <ol className="space-y-3">
            {(report.history ?? []).map((ev, i) => (
              <HistoryItem key={i} event={ev} />
            ))}
          </ol>
        </section>
      )}

      <section className="space-y-3 rounded-xl bg-neutral-100/60 p-5 dark:bg-neutral-900/50">
        <label className="block text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-500">
          Note (optionnelle)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder={
            closed
              ? "Pourquoi réouvres-tu ce cas ?"
              : "Justification, étapes prises…"
          }
          className="w-full resize-none rounded-lg bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-800 dark:text-neutral-100"
        />
        {err && (
          <p className="text-xs text-red-600 dark:text-red-400">{err}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          {closed ? (
            <button
              type="button"
              onClick={() => act("reopened", false)}
              disabled={busy}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-30"
            >
              Réouvrir
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => act("resolved")}
                disabled={busy}
                className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-emerald-100 dark:text-neutral-300 dark:hover:bg-emerald-900/30"
              >
                Résolu (sans ban)
              </button>
              <button
                type="button"
                onClick={() => setBanOpen(true)}
                disabled={busy}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-30"
              >
                Bannir
              </button>
            </>
          )}
        </div>
      </section>
      <BanModal
        open={banOpen}
        peerNick={report.reported_nick}
        onClose={() => setBanOpen(false)}
        onSubmit={async (duration: BanDuration, reason: string) => {
          await banFromReport(report.id, duration, reason);
          window.location.href = "/admin/reports";
        }}
      />
    </main>
  );
}

function HistoryItem({ event }: { event: ReportEvent }) {
  const map: Record<string, { label: string; cls: string }> = {
    report_resolved: {
      label: "Résolu",
      cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    },
    report_dismissed: {
      label: "Ignoré",
      cls: "bg-neutral-500/15 text-neutral-700 dark:text-neutral-300",
    },
    report_reopened: {
      label: "Réouvert",
      cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    },
  };
  const m = map[event.action] || { label: event.action, cls: "" };
  return (
    <li className="rounded-lg bg-neutral-100/60 p-3 dark:bg-neutral-900/50">
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${m.cls}`}
        >
          {m.label}
        </span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          par <span className="font-medium">{event.actor}</span>
        </span>
        <span className="ml-auto text-[11px] text-neutral-500 dark:text-neutral-500">
          {new Date(event.created_at).toLocaleString("fr-FR")}
        </span>
      </div>
      {event.note && (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-neutral-700 dark:text-neutral-300">
          « {event.note} »
        </p>
      )}
    </li>
  );
}

function Field({
  label,
  value,
  mono,
  full,
}: {
  label: string;
  value: string;
  mono: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-500">
        {label}
      </p>
      <p
        className={`mt-1 break-all text-sm text-neutral-900 dark:text-neutral-100 ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
