# CLAUDE.md — guide agent

Résumé succinct pour les futurs agents. Détail produit/stack complet : voir [README.md](README.md).

## Le projet en une phrase

Jolyne = chat d'échange linguistique temps réel. Appariement par paire de langues (parle X / veut Y) via files Redis ; **tuteur IA Claude** en repli quand la file est vide. + traduction, grammaire, comptes, profils+vérif visage, amis & streaks, premium Stripe, push.

## Structure

- `backend/` — Go 1.26, un seul binaire gateway (HTTP + WebSocket).
  - `cmd/gateway/` — entrypoint + `routes.go` (toutes les routes HTTP/WS, lecture rapide pour la carte des endpoints).
  - `internal/<domaine>/` — un package par domaine : `matcher` (Lua/Redis), `ws` (chat, bot IA, amis, inbox), `users`, `profile`, `friends`, `billing`, `quota`, `moderation`, `admin`, `claudeapi`, `translate`, `grammar`, `push`, `db` (migrations SQL numérotées).
- `frontend/` — Next.js 15 App Router, React 19, TS, Tailwind, Zustand. `src/app/` (pages), `src/components/`, `src/lib/` (clients API, i18n 10 langues), `src/stores/` (Zustand).
- `infra/` — compose **dev**, `face-matcher/` (Flask + face_recognition), `toxicity-scorer/` (Detoxify), k6 (charge). Prod = `docker-compose.yml` racine déployé par Dokploy/Traefik (env vars dans l'UI Dokploy, voir README §Déploiement).

## Commandes

| Quoi | Commande |
|------|----------|
| Front dev | `cd frontend && pnpm dev` (Turbopack) |
| Front lint/types | `pnpm lint` · `pnpm typecheck` |
| Front build | `pnpm build` |
| Back build | `cd backend && go build ./...` |
| Back tests | `go test ./...` (intégration : nécessite Redis/Postgres) |
| Back lint | `golangci-lint run` (config `.golangci.yml`) |
| Stack dev complète | `docker compose -f infra/docker-compose.dev.yml up` (le compose racine = prod Dokploy, réseau externe) |

Pas de Makefile. Front = **pnpm** (pas npm).

## Conventions (impératif — préférences du mainteneur)

- **Commits** : anglais, mode impératif (`add X`, `fix Y`), **≤ 20 mots, sujet seul** — pas de corps, pas de bullets, pas de bloc rationale. Si ça ne tient pas, découper le commit.
- **Aucune attribution IA / Claude** dans commits, PRs ou commentaires de code (`Co-Authored-By` interdit).
- **Branche** : le travail vit sur `main`. Vérifier le HEAD live avant commit (ne pas se fier au snapshot d'env).
- **Code** : commentaires en français (cf. existant), mais commits en anglais.
- Ne commit/push que si l'utilisateur le demande.

## Règles d'or (référencées par numéro dans les commentaires du code)

1. **Jamais logger ni persister le contenu d'un message de chat** (RGPD) — métadonnées uniquement. Seule dérogation : le chat entre amis mutuels (persisté, jamais loggé).
2. **Sanitization XSS des deux côtés** (serveur ET client) ; `dangerouslySetInnerHTML` interdit.
3. Toute validation front est **re-jouée côté serveur**.
4. **Cleanup Redis garanti** : tout état de session a un TTL ou une libération explicite (sinon slots fantômes qui bloquent le matching).
5. **Heartbeat WS strict** : ping/pong 15 s, kill à 30 s ; kill plutôt que bloquer.
6. **Pas de PII dans logs/télémétrie** : emails et IP hashés, jamais de pseudo.
7. Seule la **modération humaine bannit définitivement** ; l'auto throttle/suspend seulement.
8. **1-vs-1 strict** — pas de salles ni de groupes (non négociable produit).
9. **Age gate 16+ vérifié côté serveur** (claim explicite exigé, pas déduit de l'UI).
10. **Webhooks Stripe idempotents** (signature vérifiée + unicité `event.id`).
11. **~400 lignes max par fichier** — au-delà, découper.
12. Un fichier = un concept, un package = une responsabilité.
13. Aucune mention d'IA/outils dans commits, PRs, code (cf. Conventions).

## Gotchas

- Routes montées conditionnellement : un domaine sans config (Stripe, VAPID, auth user…) renvoie 503 *avec CORS*, pas 404 — voir `unavailable()` dans `routes.go`. Exceptions voulues : `/api/admin/*` et `/metrics` restent 404 (ne pas révéler leur existence).
- IA tuteur : **aucun contenu de message n'est loggé**. Modèle `claude-haiku-4-5`.
- Analyse IA post-conversation (`ws/analyzer.go`) : seul le **matériau pédagogique dérivé** est persisté (vocab, fautes corrigées, score CECRL) — jamais la transcription.
- Matchmaking 100 % stateless : tout l'état vit dans Redis (scripts Lua atomiques).
- Migrations DB : fichiers numérotés `0001..NNNN` up/down dans `internal/db/migrations/`.
- Binaire gateway gitignoré (ne pas le committer).
