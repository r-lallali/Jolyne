"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useT } from "@/lib/i18n";
import { useUserStore } from "@/stores/userStore";

// Page de retour Checkout (succès). Le webhook Stripe pose le Premium côté DB ;
// on re-hydrate /me au mount, avec un 2e essai différé pour couvrir la latence
// éventuelle du webhook par rapport à la redirection.
export default function PremiumSuccessPage() {
  const t = useT();
  const bootstrap = useUserStore((s) => s.bootstrap);

  useEffect(() => {
    bootstrap();
    const retry = setTimeout(bootstrap, 3000);
    return () => clearTimeout(retry);
  }, [bootstrap]);

  return (
    <main className="flex h-dvh w-full flex-col items-center justify-center gap-5 px-6 text-center">
      <p className="text-4xl" aria-hidden>
        ✨
      </p>
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
        {t.premium.successTitle}
      </h1>
      <p className="max-w-sm text-balance text-sm text-neutral-500 dark:text-neutral-400">
        {t.premium.successHint}
      </p>
      <Link
        href="/"
        className="rounded-xl bg-neutral-900 px-5 py-3 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
      >
        {t.premium.backCta}
      </Link>
    </main>
  );
}
