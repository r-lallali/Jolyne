import type { NextConfig } from "next";

// Pas de headers de sécurité ici : Caddy est la source unique en prod
// (voir infra/caddy/Caddyfile). En dev (Turbopack/HMR), pas de CSP — c'est
// volontaire, sinon les scripts d'hydratation et de hot-reload se font
// bloquer. Voir CLAUDE.md §Sécurité.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
