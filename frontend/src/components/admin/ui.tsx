"use client";

import { useEffect, useState } from "react";
import { AuthError } from "@/lib/adminStats";

// Primitives partagées par les dashboards admin (cartes KPI, sections, états
// de chargement). Palette neutre cohérente avec le reste du back-office.

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {subtitle}
          </p>
        )}
      </div>
      {actions}
    </header>
  );
}

export function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 ${className}`}
    >
      {title && (
        <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-200">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        accent
          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-neutral-900 dark:text-neutral-50">
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-xs text-neutral-400">{hint}</div>
      )}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="py-16 text-center text-sm text-neutral-400">Chargement…</div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      {message}
    </div>
  );
}

// useAuthedData : charge des données qui exigent l'auth admin. Redirige vers
// /admin/login sur AuthError (cookie expiré / IP hors allowlist). `deps`
// relance la requête (filtres, plage de dates).
export function useAuthedData<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
): { data: T | null; loading: boolean; error: string } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loader()
      .then((d) => {
        if (!alive) return;
        setData(d);
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
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}

// Sélecteur de plage de dates (presets). Renvoie les bornes ISO via onChange.
const PRESETS: { label: string; days: number }[] = [
  { label: "7 j", days: 7 },
  { label: "30 j", days: 30 },
  { label: "90 j", days: 90 },
];

export function RangePicker({
  days,
  onChange,
}: {
  days: number;
  onChange: (days: number) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800">
      {PRESETS.map((p) => (
        <button
          key={p.days}
          type="button"
          onClick={() => onChange(p.days)}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            days === p.days
              ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
              : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// rangeFromDays renvoie {from, to} ISO pour les N derniers jours.
export function rangeFromDays(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}
