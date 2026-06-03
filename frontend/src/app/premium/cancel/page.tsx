"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";

// Page de retour Checkout (annulation). Aucun débit — simple message + retour.
export default function PremiumCancelPage() {
  const t = useT();
  return (
    <main className="flex h-dvh w-full flex-col items-center justify-center gap-5 px-6 text-center">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
        {t.premium.cancelTitle}
      </h1>
      <p className="max-w-sm text-balance text-sm text-neutral-500 dark:text-neutral-400">
        {t.premium.cancelHint}
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
