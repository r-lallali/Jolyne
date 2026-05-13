# Jolyne

Chat texte **1-vs-1**, anonyme, pour pratiquer une langue étrangère avec un natif.

- `PLAN.md` — roadmap, architecture, décisions produit.
- `CLAUDE.md` — conventions de code et règles d'or à respecter pour toute contribution.

## Structure du repo

```
backend/   # Go : gateway WS, matcher, API admin, webhooks Stripe
frontend/  # Next.js : landing, chat, back-office /admin
infra/     # docker-compose, Caddyfile, scripts deploy
```

## Démarrer en local

Prérequis : Go 1.22+, Node 20+, pnpm 9+, Docker.

### 1. Lancer Redis + backend en Docker

```bash
cd infra
docker compose -f docker-compose.dev.yml up --build
```

Backend exposé sur `http://localhost:8080` (`/healthz` doit répondre `{"status":"ok"}`).

### 2. Frontend en HMR

```bash
cd frontend
cp .env.example .env.local
pnpm install         # première fois : génère pnpm-lock.yaml
pnpm dev
```

Ouvre `http://localhost:3000`.

## Tests & lint

```bash
# Backend
cd backend
go test -race ./...
golangci-lint run

# Frontend
cd frontend
pnpm typecheck && pnpm lint && pnpm build
```

## Déploiement (Phase 0)

Sur le VPS, dans `infra/` :

```bash
cp .env.example .env   # renseigner JOLYNE_DOMAIN
docker compose up -d --build
```

Caddy obtient le certificat Let's Encrypt automatiquement sur le domaine renseigné.
