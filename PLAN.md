# Jolyne — Plan d'implémentation

> Clone d'Omegle textuel pivoté vers l'apprentissage des langues : mise en relation natif ↔ apprenant pour pratique linguistique instantanée et anonyme.

## 1. Principes directeurs

- **MVP first, scale later.** Un seul VPS, une seule région. Pas de K8s, pas de microservices, pas de Cloudflare Workers tant qu'on n'a pas 1000+ users concurrents.
- **Web only au lancement.** Mobile (React Native) seulement après validation du concept.
- **Anonymat par défaut**, compte optionnel pour la réputation.
- **Boucle "match → chat → next"** = produit. Tout le reste est secondaire.

---

## 2. Stack

### Backend
- **Go 1.22+** — concurrence native, idéal pour WebSocket à grande échelle.
- **`gorilla/websocket`** — la lib WS la plus mature de l'écosystème Go.
- **Redis 7** — matching engine (queues + scripts Lua atomiques), pub/sub chat, compteurs de quotas freemium (TTL 24h), bans actifs en mémoire.
- **PostgreSQL 16** — comptes, réputation, signalements, abonnements Stripe, audit modération (dès Phase 2).
- **Stripe** — paiement Premium (Checkout + Customer Portal + webhooks). Pas de PCI à gérer côté serveur.
- **Filtre obscénités multilingue** — blocklists FR/EN/ES/DE + fuzzy match (leetspeak, espaces insérés) côté serveur, appliqué aux pseudos ET aux messages. Lib type `goaway` complétée par listes maintenues en interne.

### Frontend
- **Next.js 15 (App Router)** — SSR pour SEO de la landing, client pour le chat.
- **Zustand** — state du chat (messages, statut connexion, pseudo).
- **Tailwind CSS** + **shadcn/ui** — UI rapide et propre.
- **Framer Motion** — animation lettre-par-lettre à la saisie du pseudo, transitions d'écran (matched, peer parti, déconnecté).
- **FingerprintJS (édition open source)** — identifiant device pour les quotas anonymes et l'anti-évasion de ban (en complément de l'IP, contournable via VPN).

### Infra (VPS unique)
- **Caddy** — reverse proxy + HTTPS auto (Let's Encrypt).
- **Docker Compose** — orchestration locale (Go app + Redis + Postgres + Caddy + LanguageTool + PostHog).
- **Systemd** — supervision si on préfère bare-metal au lieu de Docker.
- **Observabilité infra** : Prometheus + Grafana (containers Docker, ~200 Mo RAM total).
- **Observabilité produit** : PostHog self-host (sessions, funnels, retention) — distinct de la stack infra, pas de tracking publicitaire.

---

## 3. Architecture

```
┌─────────────┐      WSS       ┌──────────────────┐
│  Next.js    │ ◄────────────► │  Go Gateway      │
│  (Vercel    │   /ws/match    │  (gorilla/ws)    │
│   ou VPS)   │                │                  │
└─────────────┘                │   ┌──────────┐   │
                               │   │ Matcher  │   │
                               │   └────┬─────┘   │
                               └────────┼─────────┘
                                        │
                                   ┌────▼────┐
                                   │  Redis  │
                                   │ queues  │
                                   │ + pubsub│
                                   └─────────┘
```

### Convention de nommage des queues
`queue:speaks={lang},wants={lang}` — explicite et symétrique. Ex : un user FR qui apprend l'EN entre dans `queue:speaks=fr,wants=en` et le serveur cherche un peer dans `queue:speaks=en,wants=fr`.

### Flux d'un utilisateur
1. **Saisie du pseudo** sur la landing — animation lettre-par-lettre. Validation serveur : 3-20 caractères, filtre obscénités multilingue, pas de chiffres seuls, pas de caractères de contrôle. Pas d'unicité globale (deux "Alice" peuvent coexister, le fingerprint est l'ID réel).
2. **Age gate** : checkbox "j'ai 16 ans ou plus" + acceptation CGU.
3. Connexion WS avec params `?native=fr&target=en&nick=...`.
4. Vérification quota côté serveur (Free = 10 `next`/jour) via compteur Redis `quota:next:{userId|fingerprint}` (TTL 24h).
5. Le serveur cherche un peer dans `queue:speaks=en,wants=fr`.
6. Si match → crée une `room:UUID`, abonne les 2 clients au pub/sub Redis, leur envoie `{type: "matched", peer_nick: "..."}`.
7. Sinon → push dans `queue:speaks=fr,wants=en` et attend (timeout 30s → fallback ou élargissement).
8. Messages relayés via pub/sub Redis. **Sanitization XSS aller-retour** (serveur + client) avant rendu.
9. Sur "next" / déconnexion → libération atomique du slot + incrément du compteur `next` quotidien.

### Matching atomique (script Lua)
Un seul `EVAL` qui :
- POP la première entrée de la queue cible si elle existe.
- Sinon PUSH le nouveau client dans sa propre queue.
- Renvoie le matched user ou `nil`.

Évite les double-matches sans lock distribué.

---

## 4. Roadmap

### Phase 0 — Setup (J1-J2)
- Repo monorepo : `backend/` + `frontend/` + `infra/`.
- `docker-compose.yml` local : Go + Redis + Caddy.
- CI minimale (GitHub Actions) : `go test` + `next build` + lint.

### Phase 1 — MVP Core Chat (S1-S2)
- **Écran d'accueil pseudo** : saisie animée lettre-par-lettre (Framer Motion), validation serveur (longueur, filtre obscénités multilingue, caractères autorisés).
- **Age gate** : checkbox 16+ obligatoire avant entrée en queue, refus sec si décochée.
- Sélection langue native/cible côté front (4 paires au lancement).
- Handshake WS + matching engine Redis (Lua script).
- Chat texte simple, messages éphémères (pas de persistance), **sanitization XSS** aller-retour.
- Bouton **"Next"** (libère le slot, re-queue immédiatement, throttlé 1/s).
- Écrans d'état : "en attente", "matched", "peer parti", "déconnecté" — avec **reconnexion WS auto** (exponential backoff 1s→16s).
- Heartbeat ping/pong toutes les 15s, timeout 30s.
- Identifiant anonyme : UUID v4 en `localStorage` **+ fingerprint device** (FingerprintJS).
- Déploiement sur le VPS via `docker-compose up -d`.

### Phase 2 — Safety, Linguistique & Back-office (S3-S5)
- **Filtres automatiques** : obscénités sur messages, détection de patterns risqués (URL, numéros de téléphone, emails, tentatives de doxing).
- **Signalement utilisateur** : bouton 🚩 en cours de chat, capture les N derniers messages (chiffrés au repos en Postgres) → file de review humaine.
- **Back-office admin** (`/admin` dans Next.js, auth magic link séparée + allowlist IP) :
  - File des signalements à traiter (résoudre / bannir / ignorer / suspendre temporairement).
  - Liste users + bans actifs (par compte, par fingerprint, par IP) avec durée et raison.
  - Vue temps réel : matches/min, sessions actives, taille des queues, latence WS p95.
  - Audit log de toutes les actions admin (qui a banni qui, pourquoi, quand).
- **Rate limiting** : par IP **et** fingerprint (token bucket Redis), pour gêner les multi-comptes derrière VPN.
- **hCaptcha** sur l'écran d'entrée avant la queue.
- **Tooltip de traduction** : hover sur un mot → appel API (DeepL ou LibreTranslate self-hosted), compteur de mots en Redis avec TTL 24h.
- **Correction grammaticale** : LanguageTool en container (gratuit, self-hostable).

### Phase 3 — Comptes, Réputation & Monétisation (S6-S8)
- Auth optionnelle (email magic link, pas d'OAuth lourd).
- Notation post-chat (👍/👎).
- Réputation simple stockée en Postgres.
- Filtrage : les users avec mauvaise réputation sont matchés entre eux (effet "shadow ban").
- **Freemium via Stripe** (Checkout + Customer Portal + webhooks pour synchroniser `subscriptions`) :

  | | Free | Premium |
  |---|---|---|
  | "Next" / jour | 10 | illimité |
  | Tooltip traduction | 1000 mots / jour | illimité |
  | Compte requis | non | oui |

  Quotas comptés en Redis (`quota:next:*`, `quota:translate:*`) avec TTL aligné sur minuit local. Dépassement = message in-app proposant l'upgrade. Le périmètre Premium se limite à ces deux quotas — pas d'autre incitatif (décision actée).

### Phase 4 — Polish & Scale (S7+)
- Indicateur "X personnes en attente" en temps réel (par paire de langues).
- Métriques Grafana publiques (transparence).
- **Quand le VPS sature** : passer Redis en mode cluster ou ajouter une 2e instance Go derrière Caddy load balancer.

> **Hors scope définitif** : pas de salles thématiques, pas de groupes, pas de chat n-vs-n. Le produit reste strictement **1-vs-1**.

---

## 5. Déploiement sur VPS

### Pré-requis sur le VPS
- Ubuntu 22.04+ / Debian 12+.
- Docker + Docker Compose plugin.
- Nom de domaine pointant vers l'IP (pour HTTPS auto via Caddy).
- Firewall : UFW ouvert sur 80, 443, 22 (SSH).

### Workflow de déploiement
1. **Local** : `docker compose build` + push images sur GHCR (GitHub Container Registry).
2. **VPS** : `git pull` + `docker compose pull` + `docker compose up -d`.
3. Plus tard : GitHub Actions auto-deploy via SSH.

### Backups & disaster recovery
- **Snapshots OVH** quotidiens (rétention 7 j) — récupération bare-metal si le VPS meurt.
- **Postgres** : `pg_dump` nocturne chiffré → OVH Object Storage (hors VPS), rétention 30 j.
- **Redis** : RDB snapshot toutes les 6 h. Les queues sont régénérables, mais les bans et quotas freemium valent le coup d'être sauvés.
- **Cibles** : RTO 1 h, RPO 24 h (Postgres) / 6 h (Redis).
- **Runbook de restauration** testé au moins une fois avant lancement public — un backup non testé n'est pas un backup.

### Estimation ressources VPS pour le MVP
| Composant | RAM | CPU |
|-----------|-----|-----|
| Go app    | 100 Mo | 0.5 vCPU |
| Redis     | 200 Mo | 0.2 vCPU |
| Caddy     | 30 Mo  | 0.1 vCPU |
| Postgres (Phase 2+) | 300 Mo | 0.3 vCPU |
| Grafana + Prom | 250 Mo | 0.2 vCPU |
| **Total recommandé** | **2 Go RAM / 2 vCPU** | tient 5-10k WS concurrents |

---

## 6. Contraintes critiques (à ne pas oublier)

- **Heartbeat strict** : sans ping/pong, les slots "fantômes" s'accumulent dans Redis et bloquent les matches.
- **Cleanup à la déconnexion** : utiliser `defer` en Go pour libérer le slot Redis quoi qu'il arrive.
- **Backpressure côté WS** : si un client n'envoie pas d'ACK, ne pas accumuler de messages dans un buffer infini → kill la connexion.
- **RGPD** : pas de log des contenus de chat. Logs serveur = uniquement métriques (durée session, paire de langues, pas le contenu). Messages capturés lors d'un signalement = stockés chiffrés, rétention 90 j puis purge.
- **CSP stricte + sanitization XSS** : les messages sont du contenu user-controlled, c'est le vecteur d'attaque n°1. Échapper côté serveur ET côté client avant rendu, jamais `dangerouslySetInnerHTML`.
- **Age gate 16+** : checkbox bloquante avant entrée + suspension immédiate sur signalement crédible de minorité. Insuffisant légalement seul mais c'est la baseline ; à coupler avec CGU explicites.
- **Conformité DSA** : point de contact public, traitement signalements documenté, possibilité de contester un ban, rapport de transparence si on dépasse les seuils.
- **Identification multi-axes** : IP seule est contournable (VPN, mobile). Banir par **IP + fingerprint device + compte** ensemble pour gêner sérieusement les récidivistes.
- **Anti-abus** : limiter `next` à ~1/seconde par user pour éviter le farming. Quota quotidien Free (10 next) en plus.
- **1-vs-1 strict** : le matcher renvoie toujours exactement 2 users. Aucune logique de groupe, channel, ou salle — produit verrouillé sur le format.
- **Tests de charge** : `k6` ou `vegeta` à lancer **avant** chaque release majeure. Cible : 5k connexions WS concurrentes sans dégradation.

---

## 7. Risques produit

| Risque | Mitigation |
|--------|------------|
| Toxicité / contenu NSFW | Modération auto + signalements + revue humaine + ban multi-axes (IP + fingerprint + compte) |
| Mineurs <16 sur la plateforme | Age gate dur + suspension immédiate sur signalement crédible + log audit pour traçabilité |
| Bots / spam dès J1 | hCaptcha + fingerprint + rate limit + détection de patterns (copies-collés répétés, URL, numéros) |
| Asymétrie de paires (trop de FR↔EN, pas assez d'autres) | Suggestion d'apprendre une autre langue, ou bot LLM en fallback (Phase 4+) |
| Churn élevé après 1er match raté | Onboarding clair + "next" instantané, pas d'écran d'attente vide |
| Coûts API traduction explosent | Quota Free 1000 mots/j + self-host LibreTranslate dès qu'on dépasse 10k req/j |
| VPS unique = SPOF | Snapshots OVH quotidiens + backups DB hors-VPS + runbook restauration testé |
| Faux signalements / harcèlement coordonné | Validation humaine de chaque ban, possibilité de contestation, seuil de N signalements distincts |
| Stripe webhook raté = abonné qui paye sans accès | Idempotence + replay + alerte si webhook en échec >5 min |

---

## 8. Décisions

### Actées

- [x] **Nom de domaine** : jolyne.ralys.ovh
- [x] **VPS** : OVH 2 vCPU / 4 Go RAM — 51.210.6.173
- [x] **Compte** : optionnel pour Free, obligatoire pour Premium
- [x] **Langues au lancement** : 4 paires — FR↔EN, ES↔EN, DE↔EN, FR↔ES
- [x] **Âge minimum** : 16 ans (age gate + suspension sur signalement)
- [x] **Voix / vidéo** : non, jamais — strictement textuel
- [x] **Pseudo** : choix libre par l'utilisateur, saisie animée lettre-par-lettre, validation serveur (3-20 chars, filtre obscénités multilingue), pas d'unicité globale
- [x] **Monétisation** : freemium Stripe — Free = 10 next/jour + 1000 mots traduction/jour, Premium = illimité (périmètre Premium figé sur ces deux quotas)
- [x] **Modération** : humaine via back-office admin dès Phase 2
- [x] **Format de conversation** : strictement 1-vs-1. Pas de salles, pas de groupes, jamais.
- [x] **Équipe** : 2 développeurs — code review obligatoire (1 reviewer min), pas de push direct sur `main`.

### Encore à acter

- [x] **Critères "MVP validé"** : quels chiffres font passer en Phase 2 vs pivoter (sessions/j, durée médiane, retention D7) ?
- [x] **Provider traduction** : LibreTranslate self-host (gratuit, qualité moindre)
- [ ] **Blocklists multilingues** : listes maintenues en interne ou abonnement à un service (Sightengine, Hive) ?
- [ ] **Politique de bannissement** : durées par défaut (24 h / 7 j / définitif), conditions de levée, droit d'appel.
- [ ] **CGU + politique de confidentialité + DSA** : faire relire par un avocat avant le lancement public (non bloquant pour le MVP en privé/closed beta).
- [ ] **Répartition modération entre les 2 devs** : rotation hebdo de la file signalements, plage d'astreinte ?

---

*Document vivant — à mettre à jour au fil de l'implémentation.*
