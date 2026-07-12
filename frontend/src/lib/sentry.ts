// Options Sentry partagées entre l'init client (instrumentation-client.ts)
// et serveur (instrumentation.ts). Un DSN n'est pas un secret — il vit dans
// le bundle client — mais reste surchargeable via NEXT_PUBLIC_SENTRY_DSN.
//
// Règle d'or #1 : aucun contenu utilisateur ne doit sortir vers Sentry.
// Ici : pas de PII par défaut, pas de tracing (erreurs uniquement) ; le
// scrubbing des breadcrumbs est appliqué côté client (seul endroit où ils
// peuvent citer du contenu).
export const SENTRY_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  "https://7a7c3559220e4408f52e607e941143cf@o4511721029435392.ingest.de.sentry.io/4511722307911760";

export const sentryBaseOptions = {
  dsn: SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",
  sendDefaultPii: false,
  tracesSampleRate: 0,
};
