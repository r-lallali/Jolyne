"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LoginSheet } from "@/components/auth/LoginSheet";
import { PlanComparison } from "@/components/premium/PlanComparison";
import { startCheckout } from "@/lib/billing";
import { useT } from "@/lib/i18n";
import { usePaywallStore } from "@/stores/paywallStore";
import { useUserStore } from "@/stores/userStore";

// PaywallModal : feuille unique montée à la racine. Déclenchée par
// usePaywallStore.show(source) depuis n'importe où (swipe, traduction, prof
// IA). Anonyme → propose de se connecter d'abord (compte requis pour Premium) ;
// connecté → bouton Checkout Stripe.
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
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
            onClick={hide}
          >
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-t-3xl bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-xl dark:bg-neutral-950 sm:rounded-3xl sm:pb-6"
            >
              <p className="text-center text-3xl" aria-hidden>
                ✨
              </p>
              <h2 className="mt-2 text-center text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                {t.premium.sheetTitle}
              </h2>
              <p className="mt-1 text-center text-sm text-neutral-500 dark:text-neutral-400">
                {reason}
              </p>

              <div className="mt-5">
                <PlanComparison />
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
                    className="w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-neutral-50 dark:text-neutral-900"
                  >
                    {loading ? t.premium.redirecting : t.premium.upgradeCta}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setLoginOpen(true)}
                    className="w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
                  >
                    {t.premium.loginCta}
                  </button>
                )}
                <button
                  type="button"
                  onClick={hide}
                  className="w-full rounded-xl bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {t.premium.later}
                </button>
                {error && (
                  <p className="text-center text-xs text-red-600 dark:text-red-400">
                    {t.translate.unavailable}
                  </p>
                )}
              </div>
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
