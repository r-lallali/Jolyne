# CLAUDE.md — Jolyne

Document à lire **avant** toute tâche d'implémentation. Le quoi se trouve dans `PLAN.md` (roadmap, architecture, décisions produit). Ce fichier-ci décrit **comment** écrire du code dans le repo.

---

## Contexte

Jolyne est un chat texte **strictement 1-vs-1**, anonyme, pour pratiquer une langue étrangère avec un natif. Boucle produit : `match → chat → next`. Tout le reste est secondaire.

- Équipe : **2 développeurs**.
- Code review obligatoire : 1 reviewer minimum, pas de push direct sur `main`.
- Cible matérielle : 1 VPS OVH (2 vCPU / 4 Go). Pas de K8s, pas de microservices, pas de Cloudflare Workers tant qu'on n'a pas saturé.

## Stack (résumé)

| Couche | Techno |
|---|---|
| Backend | Go 1.22+, `gorilla/websocket`, Redis 7 (Lua + pub/sub), Postgres 16 (Phase 2+), Stripe |
| Frontend | Next.js 15 (App Router), TypeScript strict, Zustand, Tailwind + shadcn/ui, Framer Motion, FingerprintJS |
| Infra | Caddy, Docker Compose, Prometheus + Grafana, PostHog self-host, LanguageTool, LibreTranslate self-host |

## Structure du repo (monorepo)

```
backend/   # Go : gateway WS, matcher, API admin, webhooks Stripe
frontend/  # Next.js : landing, chat, back-office /admin
infra/     # docker-compose, Caddyfile, scripts deploy, runbooks
```

---

## Règles d'or — non négociables

1. **Jamais logger le contenu d'un message de chat.** RGPD. Logs = métadonnées uniquement (durée session, paire de langues, IDs hashés). Pas d'exception, même pour debug temporaire.
2. **Sanitization XSS aller-retour.** Côté serveur ET côté client, jamais l'un sans l'autre. Bannir `dangerouslySetInnerHTML`.
3. **Filtre obscénités côté serveur uniquement.** Le client n'est pas un confident. Toute validation faite côté front doit être re-jouée en Go.
4. **Cleanup Redis garanti.** Tout `LPUSH`/`HSET`/`SETEX` lié à une session doit avoir un `defer` de libération **ou** un TTL. Les slots fantômes bloquent le matching.
5. **Heartbeat strict.** Ping/pong toutes les 15s, kill la connexion au timeout 30s.
6. **Pas de PII dans les logs ou la télémétrie.** Pas d'email, pas d'IP brute (hasher), pas de pseudo dans PostHog/Grafana.
7. **Modération humaine seule peut bannir définitivement.** L'auto peut throttle/suspendre, jamais bannir pour de bon.
8. **1-vs-1 strict.** Le matcher renvoie toujours exactement 2 users. Pas de salles, pas de groupes, pas de channel n-vs-n. Ce n'est pas négociable produit — si une feature suggère du multi, c'est qu'on s'est trompé.
9. **Age gate 16+ vérifié côté serveur.** La checkbox côté UI ne suffit pas — l'endpoint d'entrée en queue rejette si le claim n'est pas présent dans la session.
10. **Stripe webhooks idempotents.** Vérification signature, replay supporté, table `webhook_events` avec contrainte d'unicité sur `event.id`.
11. **Limite de taille par fichier : 400 lignes max.** Au-delà, on découpe. Un fichier qui grossit est un signal qu'il fait trop de choses.
12. **Séparer et catégoriser systématiquement.** Un module = une responsabilité. Un fichier = un concept. Si plusieurs concepts cohabitent, c'est qu'on doit splitter (voir §"Découpage" plus bas).
13. **Aucune mention de Claude / IA / outils d'assistance dans les commits, PRs, ou code.** Pas de `Co-Authored-By: Claude`, pas de "Generated with…", pas de marquage. Le code se présente comme écrit par les devs.

---

## Découpage & catégorisation du code

Règle générale : **un fichier = un concept, un package = une responsabilité.** Quand on hésite à scinder, on scinde.

### Backend Go — arborescence cible

```
backend/
  cmd/
    gateway/         # main du serveur WS
    admin/           # main du back-office API (si séparé)
    migrate/         # outil de migration DB
  internal/
    ws/              # handshake, reader, writer, heartbeat
    matcher/         # logique de matching, script Lua, queues
    quota/           # compteurs freemium (next, traduction)
    moderation/      # filtre obscénités, détection patterns
    ban/             # ban multi-axes, lookup, application
    report/          # signalements, chiffrement, file de revue
    auth/            # magic link user, magic link admin
    stripe/          # checkout, customer portal, webhooks
    user/            # comptes, réputation
    translate/       # client LibreTranslate
    fingerprint/     # vérification fingerprint client
    config/          # chargement env, validation
    db/              # connexion Postgres, migrations
    redisx/          # client Redis, helpers atomiques
    obs/             # logger, métriques Prometheus
  pkg/               # ce qui est réutilisable hors backend (rare)
```

Un fichier par concept à l'intérieur d'un package (ex: `matcher/matcher.go`, `matcher/queue.go`, `matcher/lua.go`). Pas de `utils.go` fourre-tout — si quelque chose ne trouve pas sa place, c'est qu'il manque un package.

### Frontend Next.js — arborescence cible

```
frontend/src/
  app/
    (public)/        # landing, pseudo, age gate
    chat/            # écran de chat 1-vs-1
    admin/           # back-office (auth séparée)
    api/             # route handlers (rare, préférer le backend Go)
  components/
    chat/            # composants spécifiques au chat
    pseudo/          # composants animation pseudo
    admin/           # composants du back-office
    ui/              # primitives shadcn/ui
  stores/            # un store Zustand par domaine (chatStore, pseudoStore, ...)
  lib/
    ws/              # client WS, reconnexion, backoff
    sanitize/        # DOMPurify wrapper
    fingerprint/     # init FingerprintJS
    api/             # client HTTP backend
  hooks/             # un hook par fichier
  types/             # types partagés
```

Pas de barrel files. Imports directs.

### Limite de taille

- **400 lignes max par fichier**, code + commentaires inclus.
- Au-delà, scinder par responsabilité (pas couper en deux artificiellement). Si on n'arrive pas à scinder proprement, c'est que le fichier mélange plusieurs concepts.

---

## Backend Go

### Conventions

- `go fmt` + `golangci-lint` passent en CI, sinon merge bloqué.
- Erreurs : `fmt.Errorf("contexte: %w", err)`. Jamais `_ = err`. Jamais de panic en chemin chaud.
- Tout handler prend `ctx context.Context` en premier paramètre et le propage.
- Logs : `log/slog` structuré, sortie JSON en prod, texte coloré en dev.
- Pas d'`interface{}` / `any` pour "gagner du temps" — typer correctement.
- **400 lignes max par fichier**. Au-delà, splitter par concept dans le même package.

### WebSocket

- Une goroutine **reader** + une goroutine **writer** par connexion. Jamais d'écriture concurrente sur `*websocket.Conn`.
- Channel de sortie bufferisé à taille fixe (≤ 32 messages). Si plein → kill la connexion, ne jamais bloquer.
- Heartbeat ping/pong 15s, deadline d'écriture 10s.
- `defer` systématique pour libérer le slot Redis et incrémenter la métrique de cleanup.
- Backpressure : si le client n'envoie pas d'ACK applicatif, ne pas accumuler de buffer infini → close.

### Redis

- Convention de queues : `queue:speaks={lang},wants={lang}`. Aucun autre format.
- Matching atomique **uniquement** via script Lua (`EVAL`). Pas de combinaison `LPOP` + `LPUSH` en deux commandes (race condition garantie).
- Quotas : `quota:{type}:{userId|fingerprint}` avec TTL aligné minuit local. `INCR` puis vérif > seuil.
- Bans : `ban:{ip|fingerprint|userId}` avec TTL = durée du ban. Lookup à la connexion ET à chaque `next`.
- Pub/sub : un channel `room:{uuid}`, désabonnement explicite au cleanup.

### Postgres

- Migrations versionnées (`golang-migrate` ou `goose`). Pas de DDL ad-hoc en prod.
- Pas de `SELECT *` — lister les colonnes.
- Transactions explicites pour toute mutation multi-table (signalement + ban, paiement + activation Premium).
- Tables sensibles (signalements) : chiffrement applicatif des messages capturés (clé en variable d'env, jamais en code).

### Tests

- Unitaires sur le matcher (interface mockable, pas de Redis nécessaire pour la logique pure).
- Intégration avec Redis et Postgres via `testcontainers-go`.
- Tests de charge `k6` avant chaque release majeure. Cible : 5k WS concurrents sans dégradation.
- Couverture cible : >70% sur le matcher et le quota engine, le reste au jugement.

---

## Frontend Next.js

### Conventions

- App Router uniquement, pas de Pages Router.
- TypeScript strict (`strict: true`, `noUncheckedIndexedAccess: true`).
- Server Components par défaut. `'use client'` uniquement quand nécessaire (chat, formulaires, animations).
- Styles : Tailwind + shadcn/ui. Pas de CSS-in-JS, pas de styles inline sauf cas exceptionnel justifié en revue.
- Pas de barrel files (`index.ts` qui ré-exporte tout) — import direct du fichier.
- **400 lignes max par fichier** (composants compris). Au-delà : extraire sous-composants, hooks, ou helpers.
- Un composant = un fichier. Pas plusieurs composants dans le même `.tsx` sauf composants privés strictement liés.

### State

- Zustand pour le state du chat (messages, statut WS, pseudo, peer). Stores séparés par domaine.
- Pas de Redux. Pas de Context React pour du state mutable global.
- Persistance localStorage : pseudo + UUID anonyme. Rien d'autre.

### WebSocket côté client

- Reconnexion auto avec exponential backoff (1s, 2s, 4s, 8s, 16s, cap).
- Écoute `online`/`offline` du navigateur, pause de la reconnexion si offline.
- Tous les messages reçus passent par un sanitizer (`DOMPurify`) avant rendu. Pas de raccourci.

### Animation pseudo

- Framer Motion, animation lettre-par-lettre via `stagger`.
- Délai par lettre : 40-60 ms. L'animation ne doit jamais empêcher l'utilisateur d'avancer (pas de bloquant sur la fin de l'animation pour valider).

### Back-office `/admin`

- Vit dans le même Next.js, sous `/admin/*`.
- Middleware Next.js qui vérifie : session admin valide **et** IP dans l'allowlist. Échec → 404 (pas 401, ne pas révéler l'existence de la route).
- Auth admin séparée de l'auth user (magic link, jamais OAuth).
- Toute action admin → entrée d'audit log Postgres (qui, quoi, quand, pourquoi, IP).

---

## Sécurité

- **CSP stricte** définie dans `next.config.js` ET renforcée par Caddy. Pas de `unsafe-inline`, pas de `unsafe-eval`. Nonce pour les scripts inline indispensables.
- **Sanitization XSS** : `DOMPurify` côté client, `html.EscapeString` (ou équivalent) côté serveur. Toujours les deux.
- **Rate limiting** : token bucket Redis par IP **et** fingerprint. Ne pas se contenter de l'IP — VPN trivial à utiliser.
- **Bans multi-axes** : un ban actif sur un user pose simultanément un ban sur son IP, son fingerprint et son compte (s'il existe).
- **Secrets** : variables d'environnement, jamais commités. `.env.example` documente les clés sans valeurs.
- **Dépendances** : `go mod tidy` et `pnpm audit` en CI, échec si vuln critique.

## RGPD & DSA

- Pas de log des contenus de chat. Vérifié en revue, vérifié en grep automatisé sur la CI (`rg "msg\.Content" --type go | grep -i log`).
- Messages capturés lors d'un signalement : chiffrés au repos, rétention 90 j puis purge automatique (cron).
- Droit à l'effacement : endpoint authentifié qui purge compte + signalements liés + supprime client Stripe. Documenté pour le user.
- Point de contact DSA public obligatoire avant lancement.

## Modération

- Tout signalement → file Postgres pour revue humaine. **Aucun ban auto définitif**.
- Modération assurée par les 2 devs au début (rotation à définir, voir `PLAN.md` §8).
- Le back-office permet : résoudre, suspendre N jours, bannir, ignorer. Toutes les actions sont traçables.
- Faux signalements : seuil de N signalements **distincts** (par fingerprint différents) avant escalade.

---

## Git, commits, PRs

- Branches : `feat/...`, `fix/...`, `chore/...`, `refactor/...`. Pas de `feat-` ni d'underscore.
- Commits : impératif court ("add matcher Lua script"), anglais. Pas de "wip" sur `main`.
- **Aucune mention de Claude, IA, ou outil d'assistance dans les messages de commit ni dans les PRs.** Pas de `Co-Authored-By: Claude`, pas de `Generated with Claude Code`, pas de trailer de ce genre. Le contenu doit refléter le travail comme s'il avait été écrit par les devs.
- PR : description courte (1-3 puces sur le *why*), checklist de test, lien vers le ticket si applicable. Même règle : pas de mention d'outil d'IA.
- Review obligatoire (1 reviewer min, équipe de 2). Pas de merge si CI rouge.
- Pas de force-push sur des branches déjà reviewées sauf accord explicite du reviewer.

---

## Anti-patterns à proscrire

- Logger un message de chat "juste pour debug".
- Lock distribué pour le matching (utiliser le script Lua atomique).
- Mocker Stripe en intégration (utiliser le mode test Stripe avec webhooks réels via `stripe listen`).
- Skip de migrations en prod ("on corrigera la prochaine fois").
- Ajouter une logique de groupe / channel / salle, même expérimentale. Le produit est 1-vs-1.
- Bannir définitivement sans revue humaine.
- `useEffect` pour fetch côté Next.js — Server Component ou `fetch` côté serveur si possible.
- Toute logique qui dépend du fait qu'un user "est forcément" anonyme OU connecté — les deux co-existent en permanence.
- Coupler le front à une URL d'API hardcodée. Toujours via variable d'env.

---

## Demander confirmation avant d'agir

- Changement de schéma Postgres (impacte modération + abonnements).
- Changement du script Lua de matching.
- Changement de la CSP ou des règles de sanitization.
- Toute action affectant les bans en cours (lift, modification de durée, purge).
- Déploiement en prod hors release planifiée.
- Suppression ou rotation de secrets (Stripe, magic link, DB).

---

## Quand il y a un doute

Lire `PLAN.md` d'abord. Si la réponse n'y est pas, ouvrir une discussion plutôt que choisir silencieusement — l'équipe étant de 2, une décision implicite mal prise se paye vite.
