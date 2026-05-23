# Jolyne — Contexte projet

> Document de référence pour reprendre rapidement le contexte du projet
> sans relire l'intégralité du code ou de l'historique des conversations.
> À jour au commit `c21787e`. Lire avec `CLAUDE.md` (règles d'écriture
> de code) et `PLAN.md` (roadmap produit).

---

## 1. Produit

**Jolyne** est un chat texte **strictement 1-vs-1**, anonyme par défaut,
conçu pour pratiquer une langue étrangère avec un natif. Boucle :
`match → chat → next`.

- Cible matérielle : 1 VPS OVH (2 vCPU / 4 Go), pas de K8s
- 2 devs, code review obligatoire (1 reviewer min)
- Domain prod : `https://jolyne.ralys.ovh`, API : `https://api.jolyne.ralys.ovh`
- Hosting via **Dokploy** (le compose et les env vars vivent là-bas)
- Le code se présente comme écrit par les devs — **aucune mention de Claude/IA**
  dans les commits, PRs, ou code (cf. CLAUDE.md règle #13 + memory `feedback_no_ai_attribution`)

---

## 2. Stack

| Couche | Techno |
|---|---|
| Backend | Go 1.22+, `gorilla/websocket`, Redis 7 (Lua + pub/sub), Postgres 16, Stripe (Phase 2) |
| Frontend | Next.js 15 App Router, TypeScript strict, Zustand, Tailwind + shadcn/ui, Framer Motion, FingerprintJS |
| Infra | Caddy, Docker Compose, Prometheus + Grafana, LibreTranslate, LanguageTool, face-matcher (Python) |
| LLM | Anthropic Messages API (claude-haiku-4-5) — uniquement pour le bot prof |

---

## 3. Architecture haut niveau

```
client (Next.js) ── WS /ws/match ──┐
                                   ├─→  ws.Handler ──→ matcher (Redis Lua) ──→ room (Redis pub/sub)
                                   │
client ── WS /ws/friend/{id} ──────┤    ws.FriendHandler ──→ friends store (Postgres) + room pub/sub
                                   │
client ── WS /ws/inbox ────────────┘    ws.InboxHandler ──→ subscribe à tous les channels friend du user
                                                              + un channel meta user_inbox:<uid>

backend ── HTTP /api/* ──→ users / profile / friends / push / translate / grammar handlers
backend ── Python service face-matcher (port 5001) ── pour la vérification photo profil
backend ── HTTP Anthropic API ──→ bot prof IA (cf. §10)
backend ── HTTPS web push ──→ navigateur via Service Worker
```

### Structure repo

```
backend/
  cmd/gateway/       — main.go, routes.go, services struct
  internal/
    auth/            — magic link user, magic link admin
    bans/            — service bans multi-axes
    blocking/        — block-list personnelle (auto sur report)
    claudeapi/       — wrapper HTTP Anthropic Messages API (uniquement pour bot)
    config/          — env vars
    db/              — pgxpool + migrations SQL (0001-0014)
    friends/         — friendships, messages persistés, inbox pub/sub, streaks
    matcher/         — Lua atomique + queue Redis
    moderation/      — blocklist + sanitize/escape HTML
    profile/         — profil utilisateur + photos Cloudinary + vérification
    push/            — Web Push (VAPID, subscriptions, sender)
    quota/           — compteurs freemium (next, traduction)
    reports/         — signalements chiffrés
    session/         — Session struct (ephemeral, par WS)
    translate/       — LibreTranslate client
    users/           — auth user (magic link)
    ws/              — handler /ws/match, /ws/friend/, /ws/inbox + bot_*.go (bot peer)
frontend/
  src/
    app/             — App Router (page.tsx, /chats, /account, /admin, /auth, /legal, layout, manifest, apple-icon)
    components/      — chat/, friends/, account/, auth/, notifications/, ui/, ChatWordmark, ThemeToggle, ModeTabs, Conversation
    hooks/           — useMatch, usePhotoDrag
    lib/             — ws, friend_ws, inbox_ws, push, account, friends, sanitize, i18n/{fr,en,es,de,types}, langs
    stores/          — chatStore, sessionStore, userStore, notificationStore (Zustand)
infra/
  face-matcher/      — Python (Flask + dlib + face_recognition) pour HandleVerify
  docker-compose.{yml,dev.yml}
docs/
  CONTEXT.md         — ce fichier
```

---

## 4. Chat anonyme (mode "anon")

### Flow

1. Client ouvre `/ws/match?nick=Alice&speaks=fr&wants=en&fp=<hash>&age=ok`. Params validés AVANT upgrade WS (400 JSON sinon).
2. Server `runSession` boucle : `TryMatch` (Lua atomique) → si peer dispo → `Hub.Wakeup(peer)` + `runChat` ; sinon `RPUSH` dans `queue:speaks=fr,wants=en` et attend `<-wakeup`.
3. Timeout queue = 30s sans peer humain → `ServerError code=queue_timeout`. **Mais** le bot prof IA intercepte à 10s (cf. §10).
4. `runChat` ouvre une room Redis pub/sub `room:{uuid}`. Frames :
   - Client : `msg`, `typing`, `correct`, `report`, `next`, `friend_accept`
   - Server : `queued`, `matched`, `msg`, `typing`, `correction`, `peer_left`, `friend_prompt`, `friend_made`, `friend_skipped`, `peer_profile`, `error`
5. Sur `next` : quota check, exit boucle chat, retour `runSession` pour nouveau match
6. Sur `report` : capture les 20 derniers messages (chiffrement applicatif AES-256, table `reports` Postgres), auto-block peer (fingerprint), envoie Left + queue
7. Sur peer disconnect : Left du défer de l'autre côté → l'autre passe en `post_chat`

### Frames clés

| Frame | Direction | Payload |
|---|---|---|
| `matched` | S→C | `room`, `peer_nick`, `is_bot?` |
| `msg` | bidir | `body` (HTML-escapé), `id` (ephemeral UUID) |
| `correction` | bidir | `target_id`, `original`, `body`, `note` |
| `peer_profile` | S→C | `peer_photo_id`, `peer_prompts`, `peer_verified` (seulement si peer authed) |
| `friend_prompt` | S→C | déclenché à T+10min si les 2 peers sont authed (skipped si bot) |

### Persistance

**Aucun contenu** de message anonyme n'est persisté ni loggé. Seulement les métadonnées (durée session, langues, IPs hashées). Voir CLAUDE.md règle d'or #1.

Exception : sur report, les 20 derniers messages sont **chiffrés** (clé `REPORT_ENCRYPTION_KEY`) et stockés en Postgres pour revue humaine. Rétention 90 jours.

---

## 5. Chat ami (mode "friends")

Persistant, bilatéral, accessible via :
- Inline depuis la home (`mode === "friends"` dans `Conversation.tsx` → `FriendsMode`)
- Page dédiée `/chats/[id]` (utilise `FriendConversation`)

### Flow

1. Friendship créée via le prompt 10-min en fin de session anonyme (les deux peers acceptent → `friend_made` frame + INSERT dans table `friends`)
2. `/ws/friend/{id}` : WS auth-only, Redis pub/sub channel `friend:<friendID>`, messages persistés dans `friend_messages` table
3. Frames serveur : `history`, `msg`, `peer_removed`, `read`, `typing`, `error`
4. Read receipt : auto mark-read à l'ouverture, push `read` event au peer
5. Édition possible dans une fenêtre de 5min (`friends.EditWindow`)
6. Soft delete (preserve l'ordre, body vidé)

### Streaks (style TikTok)

- Bilatéral strict : les deux doivent envoyer au moins un msg / jour UTC
- Affiché à partir de N ≥ 2
- "À risque" (⌛) quand `last_streak_day = hier` et au moins un côté n'a pas encore écrit aujourd'hui
- Milestones : 3, 7, 14, 30, 50, 100, 365 → push web + toast in-app aux deux
- **Restauration** : 3 jetons par mois calendaire UTC par user, consommables uniquement en accord bilatéral, fenêtre 7 jours après la perte
- Logique dans `friends/streaks.go` : `UpdateStreakOnMessage` (appelé dans la tx `AppendMessage`), `RestoreStreak` (bilateral consent + token spend)
- UI : `StreakBadge` (🔥 / ⌛ / 💔) dans `FriendsMode` row + `FriendConversation` header, `StreakRestoreModal` pour la flow restauration
- Migration `0014_friend_streaks.up.sql`

---

## 6. Notifications

### Inbox WebSocket

- Un seul WS global par user authed : `/ws/inbox`
- Backend subscribe à tous les `friend:<id>` channels du user + le channel meta `user_inbox:<uid>`
- Forwarde au client : `msg` (sauf si sender = self), `read`, `removed`, `friends_changed`, `streak_milestone`, `streak_restored`
- Code : `backend/internal/ws/inbox_handler.go`
- Client : `frontend/src/lib/inbox_ws.ts`, monté dans `InboxProvider`

### Toast in-app (style "ajout au panier")

- `notificationStore` Zustand : `unreadByFriend`, `toasts`
- `NotificationToasts` component : pile en haut à droite, auto-dismiss 5s, clic → nav vers `/chats/<id>`
- Photo fetched fraîche via `getFriendProfile()` pour chaque toast `msg` (évite photo périmée)
- `cloudName` est state avec retry interval 10s (corrige le bug "photo absente")

### Bulle d'unread

- `ModeTabs` : badge chiffré avec spring animation + ring blanc, abonné directement à `notificationStore.selectTotalUnread`

### Web Push (PWA)

- Backend : VAPID (env `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`), table `push_subscriptions` (migration 0013)
- Service Worker : `frontend/public/sw.js` (écoute `push` event, affiche notif native, clic → `clients.openWindow`)
- Opt-in : banner `PushOptIn` (bas de l'écran), demande `Notification.requestPermission()` puis `pushManager.subscribe`
- Déclenchement : depuis `friend_handler.handleSend`, goroutine détachée appelle `Push.SendToUser(peerUID, payload)` avec preview tronqué à 80 chars
- iOS Safari nécessite l'install en PWA (Ajouter à l'écran d'accueil)

---

## 7. Auth user

- Magic link via Mailjet SMTP (`MAILJET_*` env)
- Cookie session signé HMAC, domain `.ralys.ovh` pour partage avec api subdomain
- `users.RequireAuth` middleware, `users.CurrentUser(ctx)` dans les handlers
- Migration table `users` : 0001-002
- Auth admin séparée (`/admin/*`) : magic link distinct, IP allowlist, audit log

---

## 8. Profil + photos

- 6 photos max par user, position 1..6, table `user_photos` (migration 0006)
- Upload direct vers Cloudinary depuis le client (URL signée via `/api/account/photos/sign`)
- Drag-and-drop pour réorganiser (`usePhotoDrag` hook, pointer events unifiés mouse + touch)
- Contrainte UNIQUE `(user_id, position)` est **DEFERRABLE** (migration 0012) — permet les swaps atomiques dans la tx de reorder
- Compaction : à l'upload, si la position demandée > count+1, on clamp à count+1 (évite les trous)
- Position 1 = avatar visible en chat anonyme + amis

### Vérification photo (badge "Profil vérifié")

- `VerificationCard` component : modal portal rendered to document.body (échappe au `backdrop-blur` parent qui sinon brisait le fixed positioning)
- Stream caméra `getUserMedia` (face-aware crop), prend un selfie, upload Cloudinary
- Backend `/api/account/verify` envoie au service Python `face-matcher` (port 5001) qui utilise `dlib + face_recognition` pour comparer au public_id position 1
- Seuil 0.6, retourne `{verified, confidence}`
- `user_profiles.is_verified` resetté à false sur upload/reorder position 1

---

## 9. Bot prof IA (commit c21787e)

### Pourquoi
Chat anonyme dépendait du match humain. Sur paires rares (DE↔FR, ES↔FR) ou heures creuses, attente 30s → timeout. Bot prof prend la main à 10s pour offrir une expérience continue.

### Comment
- Pas de WS séparé : le bot tourne en goroutine côté backend, s'enregistre comme peer normal via `Hub.Wakeup`, parle au user via la même room pub/sub
- Timer 10s armé dans `runSession` quand user est en queue, annulé sur match humain ou disconnect
- Au tick : `matcher.RemoveFromQueue` (LREM ciblé, race-check vs match humain), génère roomID, `Hub.Wakeup(userID, {IsBot: true})`, boucle pub/sub
- Système : Claude Haiku 4.5 (`ANTHROPIC_API_KEY` requis sinon désactivé), system prompt prof bienveillant par langue (FR/EN/ES/DE)
- Personas : Mia (FR), Liam (EN), Lucía (ES), Anna (DE)
- Quota dur : 50 messages bot / session → goodbye localisé + Left
- Concurrence cap : 20 simultanés (env `BOT_MAX_CONCURRENT`)
- Front : badge "🤖 Prof IA" via flag `is_bot` dans frame `matched`, toast d'intro 1x/session navigateur
- Disclosure RGPD ajoutée à `/legal` (Anthropic processing)

### Fichiers
- Backend : `internal/claudeapi/client.go`, `internal/ws/bot_manager.go`, `internal/ws/bot_persona.go`, `internal/ws/bot_fallback.go`, hook dans `session.go`
- Frontend : `chatStore.peerIsBot`, `ChatHeader.tsx` badge, `BotIntroToast.tsx`, i18n `botBadge`/`botIntro*` keys

### Env vars
- `ANTHROPIC_API_KEY` (requis)
- `ANTHROPIC_MODEL` (default `claude-haiku-4-5`)
- `BOT_MAX_CONCURRENT` (default 20)
- `BOT_TRIGGER_DELAY_SEC` (default 10)

---

## 10. Conventions code (extraites de CLAUDE.md + interactions)

### Règles d'or
1. **Jamais logger le contenu d'un message** — métadonnées uniquement
2. **Sanitization XSS** côté client (DOMPurify) ET serveur (`html.EscapeString`) — toujours les deux
3. **Filtre obscénités côté serveur uniquement** — le client n'est jamais source de vérité
4. **Cleanup Redis garanti** — defer LREM / TTL sur tout `LPUSH`/`HSET`/`SETEX`
5. **Heartbeat strict** WS — ping/pong 15s, kill à 30s
6. **Pas de PII dans logs** — pas d'email, pas d'IP brute (hash), pas de pseudo en télémétrie
7. **Modération humaine seule peut bannir définitivement** — auto = throttle/suspendre max
8. **1-vs-1 strict** — pas de groupes/channels
9. **Age gate 16+ vérifié serveur** — checkbox UI ≠ suffisant
10. **Stripe webhooks idempotents** — table `webhook_events` avec contrainte unique sur event.id
11. **Limite 400 lignes par fichier** — au-delà, splitter
12. **Séparer et catégoriser** — un module = une responsabilité
13. **Aucune mention de Claude/IA dans commits/PRs/code** — pas de Co-Authored-By, pas de "Generated with…"

### Style commits (du memory user)
- **≤ 20 mots, sujet seul, pas de body** (memory `feedback_commit_length`)
- **Anglais impératif** : "add X", "fix Y" (memory `feedback_commit_language`)
- **Aucune attribution IA** (memory `feedback_no_ai_attribution`)
- Si ça ne tient pas en 20 mots, splitter en plusieurs commits

### Go
- `golangci-lint` + `go fmt` en CI, sinon merge bloqué
- Errors : `fmt.Errorf("contexte: %w", err)`, jamais `_ = err`, jamais panic en chemin chaud
- Handlers prennent `ctx context.Context` en premier param et le propagent
- Logs : `log/slog` JSON en prod, texte en dev
- WS : un goroutine reader + une writer, jamais d'écriture concurrente sur `*websocket.Conn`
- Heartbeat 15s ping, 30s deadline write
- Redis : matching atomique **uniquement** via Lua (`EVAL`), jamais LPOP+LPUSH en deux commandes

### Frontend
- App Router uniquement, TypeScript strict, `noUncheckedIndexedAccess`
- Server Components par défaut, `"use client"` quand nécessaire (chat, formulaires, animations)
- Pas de barrel files, imports directs
- Zustand pour state chat (séparé par domaine), pas de Redux
- WS client : reconnexion auto avec exponential backoff (1s → 16s cap), pause si offline
- Tout msg reçu passe par DOMPurify avant rendu
- Pas de `useEffect` pour fetch — Server Component ou fetch côté serveur si possible

### Branches/PRs
- Branches : `feat/...`, `fix/...`, `chore/...`, `refactor/...`
- Review obligatoire (1 min), pas de merge si CI rouge
- Pas de force-push sur branches reviewées sans accord explicite

---

## 11. Patterns non-évidents découverts en cours de route

### `backdrop-filter` crée un containing block
Si un parent a `backdrop-blur-*`, ses enfants `fixed` sont positionnés
par rapport à lui (pas au viewport). Bug rencontré sur `VerificationCard`
→ fix : `createPortal(modal, document.body)`.

### iOS safe-area
Tous les écrans en plein page utilisent
`pt-[calc(env(safe-area-inset-top)+3.5rem)] sm:pt-*`. Le cluster avatar
(layout.tsx) et `ModeTabs` aussi. PWA "Ajouter à l'écran d'accueil"
amplifie le problème (notch + status bar consommés).

### Postgres UNIQUE non-deferrable bloque les swaps
Bug rencontré sur le reorder photos. Fix : migration 0012 rend la
contrainte `user_photos(user_id, position)` DEFERRABLE INITIALLY
IMMEDIATE, puis `SET CONSTRAINTS … DEFERRED` dans la tx de swap. **Effet
secondaire** : `ON CONFLICT (user_id, position)` ne fonctionne plus
comme arbiter (PG ne supporte pas deferrable comme target ON CONFLICT)
→ on a remplacé l'upsert par un SELECT + UPDATE/INSERT manuel dans
`SetPhoto`.

### LEFT JOIN renvoyant NULL casse les scans booléens
Bug `cannot scan NULL into *bool` sur `streak_at_risk`. Fix : `COALESCE(expr, false)` dans le SQL.

### Native HTML5 image drag intercepte les pointer events
Le drag photo échouait car `<img>` a `draggable=true` par défaut, le
browser lance une dragstart session qui interrompt nos pointer events.
Fix : `draggable={false}` + `[-webkit-user-drag:none]` + `pointer-events-none`
sur l'img (les events vont au parent slot directement).

### iOS Safari video preview race
`setSrcObject` via `setTimeout(100ms)` était fragile. Pattern correct :
`useEffect([isOpen, stream])` qui attache `srcObject` ET appelle `.play()`
explicitement (autoplay seul ne suffit pas iOS).

### Framer-motion `layout` écrase les inline transforms
Le `motion.div layout` du photo grid empêchait le drag visuel de suivre
le curseur. Fix : remplacé par `<div>` simple — perte du spring
sur reorder mais drag visuel correct.

### iOS swipe back / hardware back interceptés via popstate
Pattern utilisé dans `/account` (dirty guard) et `FriendsMode` (back
inline) : `window.history.pushState({jolyne: ...})` au mount + listener
`popstate` qui consomme l'event.

### Cookie cross-subdomain en prod
`USER_COOKIE_DOMAIN=ralys.ovh` (sans dot prefix dans go cookie API)
pour partager entre `jolyne.ralys.ovh` et `api.jolyne.ralys.ovh`.

### Compose env var passing
Les env vars posées dans Dokploy ne sont pas auto-injectées dans le
container — il faut les déclarer explicitement dans la `environment:`
block du `docker-compose.yml` avec `${VAR:-}`. Erreur classique en
ajoutant de nouvelles vars (VAPID, Anthropic).

---

## 12. Migrations DB (chronologique)

1. `0001_users` — auth user
2. `0002_user_verification_tokens`
3. `0003_reports` — signalements chiffrés
4. `0004_bans`
5. `0005_blocking` — actuellement Redis seulement (cf. `internal/blocking`)
6. `0006_profiles_and_photos` — user_profiles + user_photos
7. `0007_friends_and_chat`
8. `0008_profile_prompts` — 3 slots Q&R Hinge-style
9. `0009_friends_last_read` — read receipts
10. `0010_friend_messages_edit_delete` — soft delete + edited_at
11. `0011_automated_photo_verification` — is_verified flag
12. `0012_user_photos_deferrable_position` — contrainte DEFERRABLE pour swap
13. `0013_push_subscriptions` — Web Push
14. `0014_friend_streaks` — streaks bilatéraux + restauration

---

## 13. Env vars complètes (backend)

| Var | Default | Usage |
|---|---|---|
| `JOLYNE_ENV` | dev | log format (json en prod, text en dev) |
| `JOLYNE_PORT` | 8080 | port HTTP |
| `REDIS_ADDR` | `127.0.0.1:6379` | matcher + pub/sub + bans + cache |
| `REDIS_PASSWORD` | — | si Redis prod auth |
| `POSTGRES_DSN` | — | obligatoire dès Phase 2 (users, friends, etc.) |
| `POSTGRES_AUTO_MIGRATE` | `false` | lance migrations au boot si `true` |
| `REPORT_ENCRYPTION_KEY` | — | base64 AES-256 (32 octets) pour messages capturés |
| `ADMIN_USERS` / `ADMIN_IP_ALLOWLIST` / `ADMIN_SESSION_SECRET` / `ADMIN_COOKIE_DOMAIN` / `ADMIN_CORS_ORIGIN` | — | back-office `/admin` |
| `PUBLIC_CORS_ORIGIN` | `https://${JOLYNE_DOMAIN}` | CORS API publique |
| `LIBRETRANSLATE_URL` / `LIBRETRANSLATE_API_KEY` | — | self-hosted translate |
| `LANGUAGETOOL_URL` | — | self-hosted grammar |
| `USER_SESSION_SECRET` | — | base64 ≥32 octets, signature cookie session user |
| `USER_COOKIE_DOMAIN` | (= admin) | partage cross-subdomain |
| `PUBLIC_APP_URL` | — | racine front (pour magic links) |
| `MAILJET_*` | — | SMTP magic link |
| `CLOUDINARY_*` | — | upload photos profil |
| `FACE_MATCHER_URL` | `http://face-matcher:5001` | service Python interne |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | — | Web Push (sinon endpoints `/api/notifications/*` renvoient 503) |
| `ANTHROPIC_API_KEY` | — | bot prof IA (sinon bot désactivé silencieusement) |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5` | modèle Claude utilisé par le bot |
| `BOT_MAX_CONCURRENT` | 20 | cap de sessions bot simultanées |
| `BOT_TRIGGER_DELAY_SEC` | 10 | délai en queue avant spawn bot |

---

## 14. Historique des features livrées (par ordre approximatif des dernières sessions)

| # | Feature | Commit |
|---|---|---|
| 1 | Streak photos reorder fix (DEFERRABLE) | `a6a15f7` |
| 2 | Sauvegarde "modifications non enregistrées" sur /account | `edc232d` |
| 3 | Web Push notifications (VAPID + SW + opt-in banner) | `cb474d3` |
| 4 | Friends list polling 60s + i18n cleanup + photo gap clamp + back swipe popstate | `ee592af`/`c2fcd31`/`299de5d`/`74a0ab2` |
| 5 | Inbox WS reconnect on friends_changed | `bf4b02c` |
| 6 | Streak system bilatéral (core + UI badges) | `ce34605` |
| 7 | Streak milestones (3/7/14/30/...) + push web | `0637b1f` |
| 8 | Streak restoration bilatérale (quota mensuel 3) | `a3d96d1` |
| 9 | Mobile safe-area sur tous les écrans full-page | `7aec092` |
| 10 | Swipe horizontal entre modes anon ↔ friends | `45dd282` |
| 11 | Mode switch animation (slide directionnel + popLayout) | `451491f` |
| 12 | NotificationToasts cloud name self-fetch (fix avatar absent) | `6ab5c21` |
| 13 | Bot prof IA (Claude Haiku 4.5, 10s trigger, badge "Prof IA") | `c21787e` |

---

## 15. Trucs à savoir pour reprendre rapidement

- Le user (Ralys) a tendance à demander en français, à attendre des réponses courtes et concrètes
- Les commits doivent être **anglais impératif ≤20 mots**, mais les comments inline + i18n peuvent être en français
- Il a 1 ami test `Greg` en prod, c'est avec lui qu'il teste les features
- Le déploiement passe par **Dokploy** sur un VPS OVH (compose file = `docker-compose.yml` root)
- La migration auto-run est activée (`POSTGRES_AUTO_MIGRATE=true`)
- Le user demande souvent un **plan** avant d'attaquer des features moyennes/grosses (plan mode disponible)
- Pour les questions exploratoires (« quoi améliorer ? »), une réponse de 5-7 puces avec trade-offs est préférée à une longue analyse
- **Le pattern qui marche** : explorer → questionner les ambiguïtés → planifier → exécuter en commits atomiques → vérifier build/tests → push
