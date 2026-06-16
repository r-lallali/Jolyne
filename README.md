# Jolyne

Chat d'échange linguistique en temps réel. Les utilisateurs sont mis en relation par **paire de langues** (je parle X / je veux pratiquer Y) via des files Redis. Quand aucun partenaire humain n'est disponible, un **tuteur IA** (Claude) prend le relais avec une persona déterministe par langue. Translation et correction grammaticale intégrées, comptes utilisateurs, amis & streaks, premium Stripe, notifications push.

## Stack

| Couche | Techno |
|--------|--------|
| Backend | Go 1.25 — gateway HTTP + WebSocket (`gorilla/websocket`), `pgx` (Postgres), `go-redis`, JWT, `golang-migrate` |
| Frontend | Next.js 15 (App Router, Turbopack), React 19, TypeScript, Tailwind, Zustand, Framer Motion |
| Données | PostgreSQL (persistance), Redis (matching, sessions, quotas) |
| Services | LibreTranslate, LanguageTool, face-matcher (Flask + `face_recognition`), Cloudinary (photos) |
| IA | Anthropic Messages API (`claude-haiku-4-5`) — tuteur conversationnel |
| Paiement | Stripe (checkout, portal, webhooks) |
| Infra | Docker Compose, Caddy (reverse proxy, TLS auto, CSP), GitHub Actions, tests de charge k6 |

## Fonctionnalités

- **Matchmaking** — appariement atomique par paire de langues via scripts Lua Redis (stateless, tout l'état vit dans Redis).
- **Chat temps réel** — WebSocket (`/ws/match`), salles éphémères, reconnexion, présence.
- **Tuteur IA** — repli automatique quand la file est vide : personas par langue (greeting déterministe, correction des fautes en contexte, ton chat). Aucun contenu de message n'est loggé.
- **Traduction & grammaire** — traduction inline (LibreTranslate) et vérification grammaticale (LanguageTool) exposées en `/api/translate` et `/api/grammar`.
- **Comptes** — signup / login / vérification e-mail / reset password, sessions JWT.
- **Profils & photos** — upload Cloudinary + **vérification de visage** (selfie vs photos de profil) via service Python (`face_recognition`, seuil dlib 0.6).
- **Amis & streaks** — demandes d'amis, inbox, chats persistants, streaks avec cron de perte.
- **Premium** — abonnement Stripe (checkout/portal/webhook) et système de quotas.
- **Notifications push** — Web Push / VAPID.
- **Modération** — filtre de profanité, modération des pseudos, signalements, bans, blocage.
- **Back-office admin** — gestion des bans, des signalements, login admin dédié.
- **i18n** — 10 langues (fr, en, es, de, it, pt, ar, ja, ko, zh).
- **Sécurité** — headers durcis via Caddy (HSTS, CSP stricte, X-Frame-Options), CORS contrôlé.

## Architecture

```
                 ┌─────────┐
   navigateur ──▶│  Caddy  │  TLS, CSP, reverse proxy
                 └────┬────┘
          /ws/* /api/*│        │ /*
                 ┌────▼────┐  ┌─▼────────┐
                 │ backend │  │ frontend │  Next.js
                 │  (Go)   │  └──────────┘
                 └──┬───┬──┘
        ┌───────────┘   └──────────┬─────────────┐
   ┌────▼────┐  ┌──────────┐  ┌────▼─────┐  ┌─────▼──────┐
   │  Redis  │  │ Postgres │  │ Anthropic│  │ face-matcher│
   │ (match) │  │          │  │  (Claude)│  │ LibreTrans. │
   └─────────┘  └──────────┘  └──────────┘  │ LanguageTool│
                                            └─────────────┘
```
