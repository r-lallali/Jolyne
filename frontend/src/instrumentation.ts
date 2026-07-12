import * as Sentry from "@sentry/nextjs";
import { sentryBaseOptions } from "@/lib/sentry";

// Init Sentry côté serveur Next (runtimes nodejs et edge — mêmes options,
// erreurs uniquement, pas de PII).
export function register() {
  Sentry.init(sentryBaseOptions);
}

// Erreurs des Server Components / route handlers.
export const onRequestError = Sentry.captureRequestError;
