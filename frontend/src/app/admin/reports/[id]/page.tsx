"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import {
  AuthError,
  getReport,
  resolveReport,
  type ReportDetail,
} from "@/lib/admin";

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

  useEffect(() => {
    if (!Number.isFinite(id)) {
      setErr("ID invalide");
      setLoading(false);
      return;
    }
    getReport(id)
      .then((r) => {
        if (!r) {
          setErr("Introuvable");
        } else {
          setReport(r);
        }
      })
      .catch((e) => {
        if (e instanceof AuthError) {
          window.location.href = "/admin/login";
          return;
        }
        setErr("Erreur de chargement");
      })
      .finally(() => setLoading(false));
  }, [id]);

  const act = async (status: "resolved" | "dismissed") => {
    setBusy(true);
    try {
      await resolveReport(id, status, note);
      window.location.href = "/admin/reports";
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
          Créé le {new Date(report.created_at).toLocaleString()} — statut :{" "}
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
          label="Raison"
          value={report.reason || "—"}
          mono={false}
          full
        />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-500">
          Conversation capturée ({report.messages.length})
        </h2>
        <div className="space-y-2 rounded-xl bg-neutral-100/60 p-4 dark:bg-neutral-900/50">
          {report.messages.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Aucun message dans la fenêtre de capture.
            </p>
          ) : (
            report.messages.map((m, i) => (
              <div key={i} className="text-sm">
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {m.from}
                </span>
                <span className="ml-2 text-[11px] text-neutral-500 dark:text-neutral-500">
                  {new Date(m.at).toLocaleTimeString()}
                </span>
                <p className="whitespace-pre-wrap break-words text-neutral-700 dark:text-neutral-300">
                  {m.body}
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      {closed ? (
        <section className="rounded-xl bg-neutral-100/60 p-5 dark:bg-neutral-900/50">
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            Traité par{" "}
            <span className="font-medium">{report.resolved_by || "—"}</span> le{" "}
            {report.resolved_at &&
              new Date(report.resolved_at).toLocaleString()}
          </p>
          {report.resolution_note && (
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
              « {report.resolution_note} »
            </p>
          )}
        </section>
      ) : (
        <section className="space-y-3 rounded-xl bg-neutral-100/60 p-5 dark:bg-neutral-900/50">
          <label className="block text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-500">
            Note (optionnelle)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Justification, étapes prises…"
            className="w-full resize-none rounded-lg bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-800 dark:text-neutral-100"
          />
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => act("dismissed")}
              disabled={busy}
              className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-200 disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              Ignorer
            </button>
            <button
              type="button"
              onClick={() => act("resolved")}
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-30"
            >
              Résolu (action prise)
            </button>
          </div>
        </section>
      )}
    </main>
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
