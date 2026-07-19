"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LoginSheet } from "@/components/auth/LoginSheet";
import { CostBreakdown } from "@/components/premium/CostBreakdown";
import { PlanComparison } from "@/components/premium/PlanComparison";
import { startCheckout } from "@/lib/billing";
import { useT } from "@/lib/i18n";
import { usePaywallStore } from "@/stores/paywallStore";
import { useUserStore } from "@/stores/userStore";

// PaywallModal : feuille unique montée à la racine, déclenchée par
// usePaywallStore.show(source) (swipe, traduction, prof IA, scénario).
// Structure : raison contextuelle → prix → avantages Free → Premium →
// répartition transparente des coûts → CTA. Anonyme → connexion d'abord
// (compte requis pour Premium) ; connecté → checkout Stripe.
export function PaywallModal() {
  const t = useT();
  const open = usePaywallStore((s) => s.open);
  const source = usePaywallStore((s) => s.source);
  const hide = usePaywallStore((s) => s.hide);
  const user = useUserStore((s) => s.user);

  const [loading, setLoading] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [error, setError] = useState(false);

  // Reset à chaque (ré)ouverture.
  useEffect(() => {
    if (open) {
      setLoading(false);
      setError(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hide]);

  const reason =
    source === "translate"
      ? t.premium.reasonTranslate
      : source === "bot"
        ? t.premium.reasonBot
        : source === "scenario"
          ? t.premium.reasonScenario
          : t.premium.reasonSwipe;

  const upgrade = async () => {
    setLoading(true);
    setError(false);
    try {
      await startCheckout(); // redirige vers Stripe (ne revient pas)
    } catch {
      setError(true);
      setLoading(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-[2px] sm:items-center sm:p-4"
            onClick={hide}
          >
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-t-3xl bg-white px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-6 shadow-2xl dark:bg-neutral-950 sm:rounded-3xl sm:px-7 sm:pb-6"
            >
              {/* En-tête : marque, raison contextuelle, prix. */}
              <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400 dark:text-neutral-500">
                Jolyne {t.premium.planPremium}
              </p>
              <h2 className="mt-2 text-center text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
                {t.premium.sheetTitle}
              </h2>
              <p className="mx-auto mt-1.5 max-w-[19rem] text-center text-sm text-neutral-500 dark:text-neutral-400">
                {reason}
              </p>

              <div className="mt-5 flex items-baseline justify-center gap-1.5">
                <span className="text-4xl font-bold tracking-tight tabular-nums text-neutral-900 dark:text-neutral-50">
                  {t.premium.priceAmount}
                </span>
                <span className="text-sm text-neutral-500 dark:text-neutral-400">
                  {t.premium.pricePeriod}
                </span>
              </div>
              <p className="mt-1 text-center text-xs text-neutral-400 dark:text-neutral-500">
                {t.premium.noCommitment}
              </p>

              <div className="mt-5">
                <PlanComparison />
              </div>

              {/* Transparence : à quoi sert concrètement l'abonnement. */}
              <div className="mt-5 rounded-2xl bg-neutral-50 p-4 dark:bg-neutral-900/60">
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                  {t.premium.transparencyTitle}
                </h3>
                <p className="mb-3 mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                  {t.premium.transparencyHint}
                </p>
                <CostBreakdown />
              </div>

              {!user && (
                <p className="mt-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
                  {t.premium.loginRequired}
                </p>
              )}

              <div className="mt-5 flex flex-col gap-2">
                {user ? (
                  <button
                    type="button"
                    onClick={upgrade}
                    disabled={loading}
                    className="h-12 w-full rounded-2xl bg-neutral-900 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-neutral-50 dark:text-neutral-900"
                  >
                    {loading ? t.premium.redirecting : t.premium.upgradeCta}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setLoginOpen(true)}
                    className="h-12 w-full rounded-2xl bg-neutral-900 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
                  >
                    {t.premium.loginCta}
                  </button>
                )}
                <button
                  type="button"
                  onClick={hide}
                  className="h-11 w-full rounded-2xl text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
                >
                  {t.premium.later}
                </button>
                {error && (
                  <p className="text-center text-xs text-red-600 dark:text-red-400">
                    {t.translate.unavailable}
                  </p>
                )}
              </div>

              <p className="mt-2 text-center text-[11px] text-neutral-400 dark:text-neutral-600">
                {t.premium.securePayment}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Connexion in-place : après login, le store user se met à jour et le
          paywall affiche alors le bouton Checkout. */}
      <LoginSheet open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}
