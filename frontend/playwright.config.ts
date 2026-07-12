import { defineConfig, devices } from "@playwright/test";

// Smoke E2E contre la vraie stack : backend Go + Redis + Postgres, frontend
// Next en dev server. Aucune clé Anthropic/Stripe : le match teste deux
// humains via Redis, l'auth teste signup/login contre Postgres.
//
// Ces tests tournent en CI (services GitHub Actions — voir
// .github/workflows/e2e.yml) : AUCUN Docker local requis. Exécution locale
// optionnelle : pointer E2E_REDIS_ADDR / E2E_POSTGRES_DSN vers n'importe
// quel Redis + Postgres joignables, puis `pnpm test:e2e`.
const BACKEND_PORT = 18080;
const FRONT_PORT = 3100;
const REDIS_ADDR = process.env.E2E_REDIS_ADDR ?? "127.0.0.1:6379";
const POSTGRES_DSN =
  process.env.E2E_POSTGRES_DSN ??
  "postgres://jolyne:jolyne@127.0.0.1:5432/jolyne?sslmode=disable";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Un seul worker : les tests partagent le même backend (files Redis) — le
  // parallélisme ferait se matcher deux tests entre eux.
  workers: 1,
  use: {
    baseURL: `http://localhost:${FRONT_PORT}`,
    // UI en français quel que soit l'OS : les sélecteurs des specs reposent
    // sur les libellés fr (i18n résout via navigator.language).
    locale: "fr-FR",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "go run ./cmd/gateway",
      cwd: "../backend",
      url: `http://localhost:${BACKEND_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        JOLYNE_ENV: "dev",
        JOLYNE_PORT: String(BACKEND_PORT),
        REDIS_ADDR,
        POSTGRES_DSN,
        POSTGRES_AUTO_MIGRATE: "true",
        // Secret de test uniquement — jamais utilisé hors E2E.
        USER_SESSION_SECRET:
          "ZTJlLW9ubHktc2VjcmV0LW5vdC11c2VkLWluLXByb2QtMDEyMzQ1Njc4OQ==",
        PUBLIC_CORS_ORIGIN: `http://localhost:${FRONT_PORT}`,
        PUBLIC_APP_URL: `http://localhost:${FRONT_PORT}`,
      },
    },
    {
      command: `pnpm exec next dev -p ${FRONT_PORT}`,
      url: `http://localhost:${FRONT_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_BACKEND_HTTP_URL: `http://localhost:${BACKEND_PORT}`,
        NEXT_PUBLIC_BACKEND_WS_URL: `ws://localhost:${BACKEND_PORT}`,
      },
    },
  ],
});
