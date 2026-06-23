"use client";

import { useState } from "react";
import { fetchRevenue } from "@/lib/adminStats";
import {
  Card,
  ErrorBox,
  KpiCard,
  PageHeader,
  RangePicker,
  Spinner,
  rangeFromDays,
  useAuthedData,
} from "@/components/admin/ui";

function euros(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

export default function RevenuePage() {
  const [days, setDays] = useState(30);
  const { from, to } = rangeFromDays(days);
  const { data: r, loading, error } = useAuthedData(
    () => fetchRevenue(from, to),
    [days],
  );

  return (
    <div className="px-6 py-8">
      <PageHeader
        title="Revenus"
        subtitle="Premium, conversion et MRR estimé."
        actions={<RangePicker days={days} onChange={setDays} />}
      />

      {loading && <Spinner />}
      {error && <ErrorBox message={error} />}

      {r && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <KpiCard
              label="MRR estimé"
              value={r.mrr_cents > 0 ? euros(r.mrr_cents) : "—"}
              hint={r.mrr_cents > 0 ? undefined : "définir PREMIUM_MONTHLY_CENTS"}
              accent
            />
            <KpiCard label="Premium actifs" value={r.active_premium} />
            <KpiCard
              label="Conversion"
              value={`${(r.conversion_pct * 100).toFixed(1)}%`}
              hint={`${r.signups_in_range} inscrits / période`}
            />
            <KpiCard
              label="Activations / churn"
              value={`+${r.activations} / −${r.cancellations}`}
            />
          </div>

          <Card>
            <p className="text-sm text-neutral-500">
              Le MRR est une estimation (premium actifs × prix mensuel). La
              source de vérité des paiements reste Stripe.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
