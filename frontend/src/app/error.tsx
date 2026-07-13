"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { useT } from "@/lib/i18n";

// Page d'erreur des routes (le layout racine reste rendu — global-error.tsx
// couvre le cas où c'est lui qui casse). Pas de message brut à l'écran :
// l'exception part à Sentry, l'utilisateur n'a besoin que de réessayer.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-2xl font-bold">{t.errors.genericTitle}</h2>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        {t.errors.genericHint}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-3 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-100 transition-opacity hover:opacity-90 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {t.errors.retry}
      </button>
    </div>
  );
}
