# CLAUDE.md — guide agent

Résumé succinct pour les futurs agents. Détail produit/stack complet : voir [README.md](README.md).

## Le projet en une phrase

Jolyne = chat d'échange linguistique temps réel. Appariement par paire de langues (parle X / veut Y) via files Redis ; **tuteur IA Claude** en repli quand la file est vide. + traduction, grammaire, comptes, profils+vérif visage, amis & streaks, premium Stripe, push.

## Structure

- `backend/` — Go 1.25, un seul binaire gateway (HTTP + WebSocket).
  - `cmd/gateway/` — entrypoint + `routes.go` (toutes les routes HTTP/WS, lecture rapide pour la carte des endpoints).
  - `internal/<domaine>/` — un package par domaine : `matcher` (Lua/Redis), `ws` (chat, bot IA, amis, inbox), `users`, `profile`, `friends`, `billing`, `quota`, `moderation`, `admin`, `claudeapi`, `translate`, `grammar`, `push`, `db` (migrations SQL numérotées).
- `frontend/` — Next.js 15 App Router, React 19, TS, Tailwind, Zustand. `src/app/` (pages), `src/components/`, `src/lib/` (clients API, i18n 10 langues), `src/stores/` (Zustand).
- `infra/` — Docker Compose, Caddy (TLS/CSP), `face-matcher/` (Flask + face_recognition), k6 (charge).

## Commandes

| Quoi | Commande |
|------|----------|
| Front dev | `cd frontend && pnpm dev` (Turbopack) |
| Front lint/types | `pnpm lint` · `pnpm typecheck` |
| Front build | `pnpm build` |
| Back build | `cd backend && go build ./...` |
| Back tests | `go test ./...` (intégration : nécessite Redis/Postgres) |
| Back lint | `golangci-lint run` (config `.golangci.yml`) |
| Stack complète | `docker compose up` (racine) |

Pas de Makefile. Front = **pnpm** (pas npm).

## Conventions (impératif — préférences du mainteneur)

- **Commits** : anglais, mode impératif (`add X`, `fix Y`), **≤ 20 mots, sujet seul** — pas de corps, pas de bullets, pas de bloc rationale. Si ça ne tient pas, découper le commit.
- **Aucune attribution IA / Claude** dans commits, PRs ou commentaires de code (`Co-Authored-By` interdit).
- **Branche** : le travail vit sur `main`. Vérifier le HEAD live avant commit (ne pas se fier au snapshot d'env).
- **Code** : commentaires en français (cf. existant), mais commits en anglais.
- Ne commit/push que si l'utilisateur le demande.

## Gotchas

- Routes montées conditionnellement : un domaine sans config (Stripe, VAPID, auth user…) renvoie 503 *avec CORS*, pas 404 — voir `routes.go`.
- IA tuteur : **aucun contenu de message n'est loggé**. Modèle `claude-haiku-4-5`.
- Analyse IA post-conversation (`ws/analyzer.go`) : seul le **matériau pédagogique dérivé** est persisté (vocab, fautes corrigées, score CECRL) — jamais la transcription.
- Matchmaking 100 % stateless : tout l'état vit dans Redis (scripts Lua atomiques).
- Migrations DB : fichiers numérotés `0001..NNNN` up/down dans `internal/db/migrations/`.
- Binaire gateway gitignoré (ne pas le committer).
