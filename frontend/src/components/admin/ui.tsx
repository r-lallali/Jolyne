"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { AuthError } from "@/lib/adminStats";
import { cn } from "@/lib/cn";

// Primitives partagées des dashboards admin. Palette neutre + un seul accent
// (emerald) pour les signaux positifs/live. Design sobre, sans ombres lourdes.

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
        <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900",
        className,
      )}
    >
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between">
          {title && (
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "default" | "accent" | "danger" | "premium";

const toneIcon: Record<Tone, string> = {
  default: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
  accent: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400",
  danger: "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400",
  premium: "bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400",
};

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: Tone;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm transition-colors hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700">
      <div className="flex items-start justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {label}
        </div>
        {Icon && (
          <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", toneIcon[tone])}>
            <Icon size={15} strokeWidth={2} />
          </span>
        )}
      </div>
      <div className="mt-2 text-[26px] font-bold leading-none tabular-nums text-neutral-900 dark:text-neutral-50">
        {value}
      </div>
      {hint && <div className="mt-1.5 text-xs text-neutral-400">{hint}</div>}
    </div>
  );
}

// Segmented : sélecteur compact (remplace les groupes de boutons). Générique
// sur la valeur.
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.value
              ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white"
              : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Skeleton : placeholder animé pendant le chargement.
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-neutral-200/70 dark:bg-neutral-800/70",
        className,
      )}
    />
  );
}

// Grille de cartes KPI en chargement.
export function KpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[92px]" />
      ))}
    </div>
  );
}

export function Spinner() {
  return <KpiSkeleton count={4} />;
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
      {message}
    </div>
  );
}

// useAuthedData : charge des données qui exigent l'auth admin. Redirige vers
// /admin/login sur AuthError (cookie expiré / IP hors allowlist).
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

// RangePicker : presets de plage de dates (segmented).
export function RangePicker({
  days,
  onChange,
}: {
  days: number;
  onChange: (days: number) => void;
}) {
  return (
    <Segmented
      value={String(days)}
      onChange={(v) => onChange(Number(v))}
      options={[
        { value: "7", label: "7 j" },
        { value: "30", label: "30 j" },
        { value: "90", label: "90 j" },
      ]}
    />
  );
}

// rangeFromDays renvoie {from, to} ISO pour les N derniers jours.
export function rangeFromDays(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

// CsvLink : petit bouton de téléchargement CSV cohérent.
export function CsvLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
    >
      CSV
    </a>
  );
}
