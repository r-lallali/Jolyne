"use client";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { usePaywallStore } from "@/stores/paywallStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUserStore } from "@/stores/userStore";

// Toggle du mode immersion (traduction automatique des messages entrants).
// Réservé Premium : un user Free qui clique voit le paywall — le réglage ne
// s'active jamais pour lui. Affiché dans le header du chat anonyme ET du
// chat ami (même mécanique, même préférence persistée).
export function AutoTranslateToggle() {
  const t = useT();
  const autoTranslate = useSessionStore((s) => s.autoTranslate);
  const setAutoTranslate = useSessionStore((s) => s.setAutoTranslate);
  const user = useUserStore((s) => s.user);
  const showPaywall = usePaywallStore((s) => s.show);

  const active = autoTranslate && !!user?.is_premium;

  const toggle = () => {
    if (!user?.is_premium) {
      showPaywall("translate");
      return;
    }
    setAutoTranslate(!autoTranslate);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t.translate.auto}
      aria-pressed={active}
      title={t.translate.auto}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-full transition-colors",
        active
          ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:bg-emerald-500/15 dark:text-emerald-400"
          : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100",
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
        aria-hidden
      >
        <path d="M5 8h7" />
        <path d="M9 4v1" />
        <path d="M5 12c0 2 2 4 5 4" />
        <path d="M13 19l3-7 3 7" />
        <path d="M14 17h4" />
      </svg>
    </button>
  );
}
