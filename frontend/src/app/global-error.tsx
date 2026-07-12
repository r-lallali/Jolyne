"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Erreurs du layout racine — error.tsx ne les voit pas. Rendu volontairement
// minimal (sans i18n ni composants applicatifs : le layout est cassé).
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <p>Une erreur est survenue. Recharge la page.</p>
      </body>
    </html>
  );
}
