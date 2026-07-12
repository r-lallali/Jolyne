import * as Sentry from "@sentry/nextjs";
import { sentryBaseOptions } from "@/lib/sentry";

// Init Sentry côté navigateur (chargé nativement par Next ≥ 15.3).
// Scrubbing règle d'or #1 :
//   - breadcrumbs console supprimés (peuvent citer des données applicatives) ;
//   - breadcrumbs réseau réduits à méthode + statut + chemin sans query.
Sentry.init({
  ...sentryBaseOptions,
  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.category === "console") return null;
    if (breadcrumb.category === "fetch" || breadcrumb.category === "xhr") {
      const rawURL = breadcrumb.data?.url;
      return {
        ...breadcrumb,
        data: {
          url: typeof rawURL === "string" ? rawURL.split("?")[0] : undefined,
          method: breadcrumb.data?.method,
          status_code: breadcrumb.data?.status_code,
        },
      };
    }
    return breadcrumb;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
