import type { NextConfig } from "next";

// CSP appliquée côté Next.js. En dev, Turbopack injecte des scripts inline
// et utilise eval, donc on relâche le `script-src`. En prod, on durcit :
// uniquement 'unsafe-inline' (nécessaire à l'hydratation Next 15), JAMAIS
// 'unsafe-eval'.
//
// Voir CLAUDE.md §Sécurité — défense en profondeur, le serveur ne réécrit
// pas les messages, DOMPurify côté client strip les tags HTML, et CSP
// refuse les exécutions hors-origine.

const isDev = process.env.NODE_ENV !== "production";

const wsURL =
  process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? "wss://api.jolyne.ralys.ovh";
const httpURL =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "https://api.jolyne.ralys.ovh";

const scriptSrc = isDev
  ? "'self' 'unsafe-inline' 'unsafe-eval'"
  : "'self' 'unsafe-inline'";

// Cloudinary : api.cloudinary.com pour les uploads signés (POST direct),
// res.cloudinary.com pour les <img src>. Toujours autoriser, même en
// dev — sinon l'upload échoue silencieusement sur "Refused to connect".
const cloudinaryConnect = "https://api.cloudinary.com";
const cloudinaryImg = "https://res.cloudinary.com";

const connectSrc = isDev
  ? `'self' ws: wss: http://localhost:* ${httpURL} ${wsURL} ${cloudinaryConnect}`
  : `'self' ${httpURL} ${wsURL} ${cloudinaryConnect}`;

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${cloudinaryImg}`,
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // HSTS uniquement en prod (sinon le navigateur épingle localhost en HTTPS)
  ...(isDev
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
