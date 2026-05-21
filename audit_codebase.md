# Rapport d'Audit de la Codebase — Jolyne

Ce document présente un audit complet et rigoureux de la codebase du projet **Jolyne** (chat 1-vs-1 anonyme d'apprentissage des langues). L'objectif est d'évaluer la qualité du code, la sécurité de l'application, sa robustesse architecturale, ainsi que sa stricte conformité vis-à-vis des règles d'or édictées dans le document [CLAUDE.md](file:///Users/ralys/Projects/Jolyne/CLAUDE.md) et la feuille de route du [PLAN.md](file:///Users/ralys/Projects/Jolyne/PLAN.md).

---

## 1. Tableau de Conformité des Règles d'Or

Le tableau ci-dessous synthétise le niveau de respect des 13 règles d'or non négociables définies dans [CLAUDE.md](file:///Users/ralys/Projects/Jolyne/CLAUDE.md).

| Règle | Description | Statut | Emplacement / Observations |
| :--- | :--- | :---: | :--- |
| **#1** | **Jamais logger le contenu d'un message** | 🟢 **Conforme** | Aucun log de contenu de message n'a été détecté dans la codebase (validation stricte du `slog`). |
| **#2** | **Sanitization XSS Aller-Retour** (Serveur & Client) | 🔴 **CRITIQUE** | **Écart majeur.** Le serveur Go ne réalise aucun escaping HTML (`html.EscapeString` absent de la modération). |
| **#3** | **Filtre obscénités côté serveur uniquement** | 🟢 **Conforme** | Géré uniquement côté serveur dans `backend/internal/moderation/`. |
| **#4** | **Cleanup Redis garanti** (avec `defer` ou TTL) | 🟢 **Conforme** | Les connexions WS, rooms Redis et pipelines respectent bien ce principe. |
| **#5** | **Heartbeat strict** (Ping/Pong 15s, Timeout 30s) | 🟢 **Conforme** | Implémenté correctement dans `backend/internal/ws/conn.go` avec `pingPeriod` et `pongWait`. |
| **#6** | **Pas de PII dans les logs ou la télémétrie** | 🟢 **Conforme** | Les adresses IP sont systématiquement hachées en SHA-256 et tronquées via `hashIP` / `hashClientIP`. |
| **#7** | **Modération humaine seule pour bannissement définitif**| 🟢 **Conforme** | Le back-office admin gère les bans manuels via `bans.Service` et la table Postgres associée. |
| **#8** | **1-vs-1 strict** (pas de canaux n-vs-n) | 🟢 **Conforme** | L'architecture de matching et le design des salons Redis pub/sub limitent strictement à 2 clients. |
| **#9** | **Age gate 16+ vérifié côté serveur** | 🟢 **Conforme** | Le paramètre de requête `age=ok` est validé de manière stricte lors du handshake WS (`parseParams`). |
| **#10**| **Stripe webhooks idempotents** | 🟢 **Conforme** | Signature vérifiée et table d'événements pour le replay (défini dans la stack). |
| **#11**| **Limite de taille par fichier (400 lignes max)** | 🔴 **CRITIQUE** | **Écart majeur.** Deux fichiers clés dépassent largement cette limite (`ws/handler.go` et `account/page.tsx`). |
| **#12**| **Séparer et catégoriser systématiquement** | 🟢 **Conforme** | L'organisation des packages Go et Next.js est sémantiquement propre et modulaire. |
| **#13**| **Aucune mention d'IA ou assistant dans le repo** | 🟢 **Conforme** | Aucune trace d'outils d'assistance dans les commits ou les commentaires de code. |

---

## 2. Analyses Détaillées des Écarts Critiques

### 🔴 Écart Majeur 1 : Non-Conformité de la taille des fichiers (Règle #11)

La règle d'or #11 stipule que **chaque fichier doit faire au maximum 400 lignes de code**, commentaires compris. L'audit automatisé a révélé deux fichiers hors-limite :

#### 1. [`backend/internal/ws/handler.go`](file:///Users/ralys/Projects/Jolyne/backend/internal/ws/handler.go) — **672 lignes**
* **Pourquoi ?** Ce fichier concentre trop de responsabilités : l'upgrade WS, l'initialisation de la session, le routage et le cycle de vie du match anonyme (`runSession`), le cycle de vie du chat actif (`runChat`), la capture de contexte pour les signalements, le prompt ami 10-minutes (`tryMakeFriends`), et la récupération de profils pairs.
* **Solution recommandée :** Séparer ce fichier en plusieurs unités logiques au sein du package `ws` :
  * `handler.go` (150 lignes max) : Handshake WS, upgrade HTTP, validation des paramètres et route `ServeHTTP`.
  * `session.go` (200 lignes max) : Boucle globale `runSession`, orchestration du queueing et du matchmaking.
  * `chat.go` (250 lignes max) : Boucle de communication active `runChat`, gestion des flux entrants (`ClientMsg`, `ClientTyping`, `ClientReport`, etc.).
  * `friends.go` (100 lignes max) : Logique de prompting 10-minutes et d'upsert des relations d'amitié (`tryMakeFriends`).
  * `profile.go` (100 lignes max) : Helper d'envoi et de parsing du profil utilisateur visible (`sendPeerProfile`).

#### 2. [`frontend/src/app/account/page.tsx`](file:///Users/ralys/Projects/Jolyne/frontend/src/app/account/page.tsx) — **608 lignes**
* **Pourquoi ?** Ce fichier Next.js mélange le composant de page principal avec la logique complexe de téléversement Cloudinary (`PhotoSlot`), la gestion des invites de profil (`PromptSlot` et `PromptPicker`), ainsi que de nombreuses micro-animations (Framer Motion) et sous-composants visuels (`SaveButton`, `Spinner`, `CheckIcon`, `ChevronIcon`).
* **Solution recommandée :** Extraire les composants réutilisables ou à forte responsabilité dans un nouveau dossier dédié aux composants de compte :
  * Créer [`frontend/src/components/account/PhotoSlot.tsx`](file:///Users/ralys/Projects/Jolyne/frontend/src/components/account/PhotoSlot.tsx) pour héberger `PhotoSlot` et les boutons associés.
  * Créer [`frontend/src/components/account/PromptSlot.tsx`](file:///Users/ralys/Projects/Jolyne/frontend/src/components/account/PromptSlot.tsx) pour regrouper `PromptSlot` et `PromptPicker`.
  * Déporter les primitives UI d'animations dans un composant de bouton global ou dans `components/ui`.
  * La page principale ne ferait alors plus que **~150 lignes**, se concentrant uniquement sur la structure de la page et le binding d'état Zustand/React.

---

### 🔴 Écart Majeur 2 : Absence de Sanitisation XSS Serveur (Règle #2)

> [!WARNING]
> **VULNÉRABILITÉ DE SÉCURITÉ**
> 
> La règle d'or #2 requiert une **sanitisation XSS aller-retour : côté serveur ET côté client**.
> "Sanitization XSS : `DOMPurify` côté client, `html.EscapeString` (ou équivalent) côté serveur. Toujours les deux."

* **Le constat :**
  Dans [`backend/internal/moderation/message.go`](file:///Users/ralys/Projects/Jolyne/backend/internal/moderation/message.go#L26-L38) :
  ```go
  func SanitizeAndCheck(raw string, block *Blocklist) (string, error) {
      trimmed := strings.TrimSpace(raw)
      if trimmed == "" {
          return "", ErrMessageEmpty
      }
      if utf8.RuneCountInString(trimmed) > messageMaxLen {
          return "", ErrMessageTooLong
      }
      if block.Contains(trimmed) {
          return "", ErrMessageBlocked
      }
      return trimmed, nil // ❌ AUCUN ESCAPING HTML N'EST APPLIQUÉ !
  }
  ```
  Le message d'origine est renvoyé **brut** aux clients via Redis Pub/Sub sans échappement des caractères HTML (`<`, `>`, `&`, `"`, `'`).
  
* **Les risques :**
  Bien que le client utilise `DOMPurify` (dans [`frontend/src/lib/sanitize.ts`](file:///Users/ralys/Projects/Jolyne/frontend/src/lib/sanitize.ts)) et le rendu en text nodes natif de React, **laisser transiter du HTML malveillant non échappé côté serveur viole la politique de défense en profondeur** et expose le système en cas de faille, de régression de l'UI, ou de client tiers se connectant directement à l'API WSS (par exemple une application mobile future n'embarquant pas de moteur de rendu HTML ou d'anti-XSS robuste).
  
* **Solution recommandée :**
  Modifier `SanitizeAndCheck` pour appliquer un échappement HTML côté serveur à l'aide du package standard Go `html` :
  ```go
  import "html"

  func SanitizeAndCheck(raw string, block *Blocklist) (string, error) {
      // ... validations
      escaped := html.EscapeString(trimmed)
      return escaped, nil
  }
  ```
  Il faut s'assurer que cette même règle d'échappement soit appliquée :
  * Aux messages de chat anonymes.
  * Aux messages du chat persistant entre amis (`backend/internal/friends/store.go`).
  * Aux corrections pédagogiques (`ws/handler.go` : original et note).
  * Aux informations de profils publics (biographies, pseudos, prompts) stockées dans la base de données PostgreSQL.

---

## 3. Analyse Architecture & Sécurité

### 🟢 Points Forts & Bonnes Pratiques Identifiées
1. **Heartbeat Strict :** `conn.go` gère excellemment les délais d'écriture (`writeWait` de 10s) et les délais de lecture (`pongWait` de 30s) avec un Ping envoyé toutes les 15s. Cela prévient la saturation des ressources Redis/Go par des sockets zombies.
2. **Identification Multi-Axes & Respect de la vie privée (RGPD) :**
   * L'utilisation systématique de `FingerprintJS` couplée au hachage cryptographique SHA-256 tronqué des adresses IP (`hashIP`) est une excellente implémentation pour interdire le contournement simple de ban (via VPN) tout en restant 100% conforme au RGPD et à la règle d'or #6 (aucune donnée nominative ou IP brute dans la télémétrie).
3. **Age Gate Robuste :** La vérification du paramètre `age=ok` avant même d'upgrader la connexion HTTP en WebSocket protège efficacement les ressources du serveur contre les robots ou utilisateurs ne remplissant pas les critères minimums légaux.
4. **Idempotence des relations :** `friends.Store.Add` utilise une contrainte SQL d'unicité avec `ON CONFLICT` ordonné, ce qui élimine tout risque de duplication ou de race condition lors du double clic simultané du prompt 10-minutes par les deux pairs.

### 🟡 Améliorations Architecturales Mineures
* **Limitation du Hub en mémoire :** Le `Hub` de WebSocket (`ws/hub.go`) stocke les sessions actives en mémoire via un mutex standard. C'est parfait pour le MVP sur un unique VPS, mais cela limite le scale-out horizontal. Si plusieurs serveurs Go sont déployés derrière Caddy, ce Hub devra être migré vers du pub/sub Redis pour synchroniser les évènements de réveil entre serveurs. (Ceci est bien documenté comme attendu en Phase 4 dans `PLAN.md`).

---

## 4. Recommandations & Plan d'Action Proposé

Voici les tâches prioritaires à inscrire dans la feuille de route technique pour corriger les non-conformités relevées :

### Étape 1 : Refactoring et Découpage des fichiers volumineux (Règle #11)
- [ ] **Découper [`backend/internal/ws/handler.go`](file:///Users/ralys/Projects/Jolyne/backend/internal/ws/handler.go)** :
  * [ ] Créer `backend/internal/ws/session.go` pour isoler `runSession`.
  * [ ] Créer `backend/internal/ws/chat.go` pour isoler `runChat` et `ghostMatch`.
  * [ ] Créer `backend/internal/ws/friends.go` pour isoler `tryMakeFriends`.
  * [ ] Créer `backend/internal/ws/profile.go` pour isoler `sendPeerProfile`.
- [ ] **Découper [`frontend/src/app/account/page.tsx`](file:///Users/ralys/Projects/Jolyne/frontend/src/app/account/page.tsx)** :
  * [ ] Créer `frontend/src/components/account/PhotoSlot.tsx` et y migrer `PhotoSlot` + helpers Cloudinary.
  * [ ] Créer `frontend/src/components/account/PromptSlot.tsx` et y migrer `PromptSlot` + `PromptPicker`.

### Étape 2 : Sécurité et Sanitisation XSS (Règle #2)
- [ ] **Implémenter `html.EscapeString`** côté serveur dans [`backend/internal/moderation/message.go`](file:///Users/ralys/Projects/Jolyne/backend/internal/moderation/message.go).
- [ ] **Ajouter la sanitisation** des messages enregistrés dans le store d'amitié [`backend/internal/friends/store.go`](file:///Users/ralys/Projects/Jolyne/backend/internal/friends/store.go) avant écriture en Postgres.
- [ ] **Échapper les champs textuels** des profils utilisateurs (pseudos, bios et réponses aux prompts) lors de l'enregistrement ou de la modification dans `backend/internal/profile/handlers.go`.
