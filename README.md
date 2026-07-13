# Jolyne

Chat d'échange linguistique en temps réel. Les utilisateurs sont appariés par **paire de langues** (je parle X / je veux pratiquer Y) via des files Redis. Quand aucun partenaire humain n'est disponible, un **tuteur IA** (Claude) prend le relais — puis s'efface dès qu'un humain arrive. Autour du chat : mode Cours façon Duolingo, carnet de vocabulaire à répétition espacée, traduction et correction grammaticale intégrées, comptes et profils vérifiés, amis & streaks, premium Stripe, modération multi-étages et back-office analytics.

## Stack

| Couche | Techno |
|--------|--------|
| Backend | Go 1.26 — gateway HTTP + WebSocket (`gorilla/websocket`), `pgx` (Postgres), `go-redis`, JWT, `golang-migrate` |
| Frontend | Next.js 15 (App Router, Turbopack), React 19, TypeScript, Tailwind, Zustand, Framer Motion |
| Données | PostgreSQL (persistance), Redis (matching, sessions, quotas, caches) |
| IA | Anthropic Messages API — `claude-haiku-4-5` : tuteur, traduction/grammaire de repli, modération nuancée, icebreakers, analyse post-conversation (Batch API) |
| Services | LibreTranslate, LanguageTool, toxicity-scorer (Detoxify / XLM-RoBERTa), face-matcher (Flask + `face_recognition`), Cloudinary |
| Paiement | Stripe (checkout, portal, webhooks) |
| Infra | Docker Compose sur VPS via Dokploy (Traefik, TLS auto), GitHub Actions, Sentry (erreurs), tests de charge k6 |

## Fonctionnalités

**Matchmaking & chat**
- **Appariement** atomique par paire de langues via scripts Lua Redis — 100 % stateless, tout l'état vit dans Redis. Taille de file exposée en public (`/api/queue-size`).
- **Chat temps réel** — WebSocket (`/ws/match`), salles éphémères, présence, reconnexion.
- **Icebreakers** — amorces de conversation générées par Claude, cachées par langue (repli statique local si l'API est froide).
- **Tuteur IA « salle d'attente »** — repli quand la file est vide : personas déterministes par langue (10 langues), greeting, correction en contexte. L'utilisateur **reste en file** pendant la session bot et bascule sur un humain dès qu'il arrive. Cap de messages, aucun contenu jamais loggé.

**Apprentissage**
- **Mode Cours** (type Duolingo) — cours → unités → leçons (contenu seedé/généré par Claude). Leçons de **vocabulaire** et d'**écriture** (kana, jamo Hangul, formes positionnelles arabes, tracé SVG des caractères). XP, **streak quotidien**, **cœurs** (5 max, régén 30 min, ou demande à un ami), succès, objectif quotidien réglable, test de placement.
- **Leçon du jour** — rejeu des fautes corrigées extraites de vos vraies conversations.
- **Carnet de vocabulaire** — révision espacée SM-2 (again/hard/good/easy), pile de cartes dues, cron de rappel.
- **Analyse post-conversation IA** — un seul appel Claude (via Batch API, −50 %) dérive de chaque chat : vocabulaire → carnet, fautes corrigées → leçon du jour, niveau **CECRL** (lissé EWMA), et réactivation SRS des mots revus en contexte. La transcription n'est **jamais** persistée.
- **Traduction & grammaire** — traduction de phrases par Claude Haiku (+ romanisation zh/ja/ko/ar), repli LibreTranslate ; correction grammaticale LanguageTool complétée par Claude pour les langues non couvertes. Exposées en `/api/translate` et `/api/grammar`.

**Comptes & social**
- **Comptes** — signup / login / vérification e-mail / reset password / logout, sessions JWT avec invalidation par version.
- **Profils** — photos Cloudinary (upload signé, réordonnancement), **vérification de visage** (selfie vs photos) via service Python (`face_recognition`, seuil dlib 0.6), prompts de profil style Hinge.
- **Amis & streaks** — demandes d'amis, inbox temps réel (`/ws/inbox`), chats persistants (`/ws/friend/`), édition/suppression de messages, streaks avec restauration et cron de perte, signalements.
- **Premium** — abonnement Stripe (checkout / portal / webhook), système de quotas, cœurs illimités.
- **Notifications push** — Web Push / VAPID.

**Modération & sécurité**
- **Modération en cascade** — blocklist statique instantanée → scorer local (sidecar Detoxify/XLM-RoBERTa, gratuit, CPU) → classifieur Claude pour la zone nuancée. Toxicité récidivante → **strikes** puis suspension automatique (fingerprint + IP).
- **Modération des pseudos**, **signalements**, **bans**, **blocage** utilisateur ↔ utilisateur, age gate.
- **Back-office admin** — login dédié + IP allowlist. Gestion des signalements et bans, dashboards analytics (overview, funnel, rétention, séries temporelles, engagement, revenu, serveur, audit), gestion des utilisateurs (premium, ban, export/suppression RGPD).
- **Analytics** — beacon d'événements front (page_view, signup, recherche de match…) et endpoint Prometheus `/metrics` (protégé par l'allowlist admin).
- **Erreurs** — Sentry côté front (client + serveur Next, breadcrumbs scrubbés) et côté gateway (logs `Error` forwardés) : seule la taxonomie des logs sort, jamais de contenu de message ni de PII.
- **Durcissement** — TLS auto (Traefik/Dokploy), headers de sécurité versionnés dans le code (CSP stricte + HSTS : `next.config.ts` côté front, middleware Go côté API), CORS contrôlé, fingerprint device, scrubbing PII.

**i18n** — interface disponible en 10 langues (fr, en, es, de, it, pt, ar, ja, ko, zh).

## Architecture

```
                 ┌─────────┐
   navigateur ──▶│ Traefik │  TLS auto (géré par Dokploy)
                 └────┬────┘
        api.jolyne.*  │        │ jolyne.*
                 ┌────▼────┐  ┌─▼────────┐
                 │ backend │  │ frontend │  Next.js
                 │  (Go)   │  └──────────┘
                 └──┬───┬──┘
       ┌────────┬───┘   └────┬──────────┬──────────────┐
  ┌────▼───┐ ┌──▼─────┐ ┌────▼─────┐ ┌──▼────────┐ ┌───▼──────────┐
  │ Redis  │ │Postgres│ │ Anthropic│ │face-matcher│ │ LibreTranslate│
  │(match) │ │        │ │ (Claude) │ │  (visage)  │ │ LanguageTool  │
  └────────┘ └────────┘ └──────────┘ └───────────┘ │ toxicity-scorer│
                                                    └───────────────┘
```

## Déploiement

Prod = un VPS OVH orchestré par **Dokploy** (Traefik en frontal, TLS auto). Le `docker-compose.yml` à la racine est le compose de prod : Dokploy le build et injecte les variables d'environnement (UI → Environment Variables — aucune n'est versionnée).

- **Domaines** (Dokploy UI → Domains) : `jolyne.ralys.ovh` → frontend port 3000, `api.jolyne.ralys.ovh` → backend port 8080. Pas de labels Traefik dans le compose : Dokploy les pose lui-même.
- **Postgres** tourne comme service Dokploy séparé sur `dokploy-network` (hors compose) ; `POSTGRES_DSN` pointe dessus.
- **Headers de sécurité** : Traefik ne pose que le TLS. La CSP/HSTS du front vit dans `next.config.ts`, celle de l'API dans le middleware `secHeaders` du gateway Go — versionnées, donc reconstructibles.
- **Traçabilité** : poser `BUILD_COMMIT` / `BUILD_VERSION` en args de build côté Dokploy, sinon le binaire log `dev`.
- **Dev local** : `docker compose -f infra/docker-compose.dev.yml up` (backend + Redis + Postgres + services) et `cd frontend && pnpm dev` à côté. Le compose racine ne monte pas en local (réseau `dokploy-network` externe).
