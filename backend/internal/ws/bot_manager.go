package ws

import (
	"context"
	"errors"
	"html"
	"log/slog"
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/claudeapi"
	"github.com/ralys/jolyne/backend/internal/matcher"
	"github.com/ralys/jolyne/backend/internal/quota"
	"github.com/ralys/jolyne/backend/internal/session"
)

const (
	// maxBotMessages : nombre de réponses du bot avant qu'il prenne congé.
	// Cap dur pour éviter une session bot infinie + coût runaway. À 50,
	// ça représente ~25 min de conversation soutenue.
	maxBotMessages = 50

	// maxBotHistoryTurns : nombre max de tours user+assistant gardés en
	// mémoire. Au-delà on tronque depuis le début (on garde toujours les
	// plus récents). 12 paires = 24 messages — assez pour tenir le fil d'un
	// chat casual tout en bornant le coût d'input (l'historique est
	// re-traité par l'API à chaque appel).
	maxBotHistoryTurns = 12

	// botJoinWait : délai max d'attente du signal `join` du user avant
	// d'envoyer le greeting quand même (fallback si le join a été raté — le
	// user est alors abonné depuis longtemps). Garantit qu'on ne parle jamais
	// dans le vide tout en restant réactif.
	botJoinWait = 1500 * time.Millisecond

	// botSettleDelay : petite pause après la présence confirmée, le temps que
	// le client affiche son ServerMatched avant le premier message du bot.
	botSettleDelay = 500 * time.Millisecond
)

// BotManager : arme un timer 10s par user mis en queue, et lance un bot
// IA pour le matcher si le timer expire (= personne ne s'est pointé).
// Singleton injecté dans le Handler ws.
type BotManager struct {
	rdb     *redis.Client
	matcher *matcher.Matcher
	hub     *Hub
	claude  *claudeapi.Client
	quota   *quota.Engine
	log     *slog.Logger

	triggerDelay  time.Duration
	maxConcurrent int

	mu         sync.Mutex
	timers     map[string]*time.Timer
	activeBots int
}

type BotManagerConfig struct {
	RDB           *redis.Client
	Matcher       *matcher.Matcher
	Hub           *Hub
	Claude        *claudeapi.Client
	Quota         *quota.Engine
	Log           *slog.Logger
	TriggerDelay  time.Duration
	MaxConcurrent int
}

func NewBotManager(cfg BotManagerConfig) *BotManager {
	if cfg.TriggerDelay <= 0 {
		cfg.TriggerDelay = 10 * time.Second
	}
	if cfg.MaxConcurrent <= 0 {
		cfg.MaxConcurrent = 20
	}
	return &BotManager{
		rdb:           cfg.RDB,
		matcher:       cfg.Matcher,
		hub:           cfg.Hub,
		claude:        cfg.Claude,
		quota:         cfg.Quota,
		log:           cfg.Log,
		triggerDelay:  cfg.TriggerDelay,
		maxConcurrent: cfg.MaxConcurrent,
		timers:        make(map[string]*time.Timer),
	}
}

// Enabled : true si le manager peut spawn un bot. Sert au caller à
// court-circuiter l'arming du timer si l'API key n'est pas posée.
func (m *BotManager) Enabled() bool {
	return m != nil && m.claude != nil && m.claude.Enabled()
}

// SpawnFor : arme un timer pour ce user. Si à T+triggerDelay le user est
// toujours en queue et qu'on a de la capacité, on spawn un bot. Idempotent
// par sessionID : un seul timer par session.
func (m *BotManager) SpawnFor(parent context.Context, userSess session.Session) {
	if !m.Enabled() {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.timers[userSess.ID]; exists {
		return
	}
	if m.activeBots >= m.maxConcurrent {
		return
	}
	t := time.AfterFunc(m.triggerDelay, func() {
		m.attemptSpawn(parent, userSess)
	})
	m.timers[userSess.ID] = t
}

// Cancel : annule le timer s'il est encore armé. Appelé quand le user est
// matché par un humain ou se déconnecte.
func (m *BotManager) Cancel(sessionID string) {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.timers[sessionID]; ok {
		t.Stop()
		delete(m.timers, sessionID)
	}
}

func (m *BotManager) attemptSpawn(parent context.Context, userSess session.Session) {
	m.mu.Lock()
	delete(m.timers, userSess.ID)
	if m.activeBots >= m.maxConcurrent {
		m.mu.Unlock()
		// Le user reste en queue jusqu'au queue_timeout — sans ce log la
		// saturation est invisible côté ops.
		if m.log != nil {
			m.log.Warn("bot capacity saturated, queued user keeps waiting", "max_concurrent", m.maxConcurrent)
		}
		return
	}
	m.activeBots++
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		m.activeBots--
		m.mu.Unlock()
	}()

	// Contexte propre au bot. On dérive du parent pour que la fermeture
	// du handler WS du user coupe aussi le bot (cleanup en cascade).
	ctx, cancel := context.WithCancel(parent)
	defer cancel()

	// NB : on ne court-circuite PAS sur quota épuisé ici. Le bot doit
	// toujours se lancer après le délai (sinon il « ne se lance pas » du
	// point de vue user) ; runBot ouvre alors par le message de limite
	// canned (sans appel Claude) puis prend congé. Voir runBot.
	speaks := matcher.LangCode(userSess.Speaks)
	wants := matcher.LangCode(userSess.Wants)
	// Sort le user de sa queue. Si la session a déjà été matchée ou
	// retirée (race avec un peer humain), on abort proprement.
	taken, err := m.matcher.RemoveFromQueue(ctx, speaks, wants, userSess.ID)
	if err != nil {
		if m.log != nil {
			m.log.Warn("bot remove from queue failed", "err", err)
		}
		return
	}
	if !taken {
		return
	}

	m.startBot(ctx, userSess)
}

// SpawnNow : lance un bot prof IA immédiatement pour ce user, sans timer ni
// passage par la queue de matching. Appelé quand le user a explicitement
// choisi le mode "Prof IA" sur l'écran de setup. Le user n'étant inscrit
// dans aucune queue, on saute le RemoveFromQueue d'attemptSpawn (pas de race
// possible avec un peer humain).
//
// Bloquant : tient toute la durée de la conversation — à appeler dans sa
// propre goroutine. Renvoie false SANS bloquer (et sans émettre de Wakeup)
// si l'IA est désactivée ou la capacité est saturée, pour que le caller
// puisse se rabattre sur le matching humain.
func (m *BotManager) SpawnNow(parent context.Context, userSess session.Session) bool {
	if !m.Enabled() {
		return false
	}
	m.mu.Lock()
	if m.activeBots >= m.maxConcurrent {
		m.mu.Unlock()
		// Visible en log : sans ça la saturation est indiscernable d'un bot
		// qui « ne se lance pas » (le caller bascule en matching humain).
		if m.log != nil {
			m.log.Warn("bot capacity saturated, falling back to human matching", "max_concurrent", m.maxConcurrent)
		}
		return false
	}
	m.activeBots++
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		m.activeBots--
		m.mu.Unlock()
	}()

	ctx, cancel := context.WithCancel(parent)
	defer cancel()

	return m.startBot(ctx, userSess)
}

// startBot réveille le user (frame `ServerMatched` IsBot=true, émise par son
// runChat) puis lance la boucle de conversation côté bot. Bloquant pour la
// durée de la conversation. Renvoie false si le Wakeup échoue (user déjà
// parti / canal plein) — dans ce cas le bot n'est pas lancé.
func (m *BotManager) startBot(ctx context.Context, userSess session.Session) bool {
	persona := personaFor(userSess.Wants)
	roomID := uuid.NewString()
	botPeerID := "bot:" + uuid.NewString()

	// On s'abonne à la room AVANT de réveiller le user : le bot est ainsi
	// garanti présent quand le user publie son `join`, donc le greeting est
	// toujours capté et n'est jamais publié dans le vide (le timer de repli
	// dans runBot ne reste qu'un filet de sécurité).
	room, err := openRoom(ctx, m.rdb, roomID, botPeerID)
	if err != nil {
		if m.log != nil {
			m.log.Warn("bot open room", "err", err)
		}
		return false
	}

	if !m.hub.Wakeup(userSess.ID, WakeupEvent{
		RoomID:   roomID,
		PeerNick: persona.Name,
		PeerID:   botPeerID,
		IsBot:    true,
	}) {
		_ = room.Close()
		if m.log != nil {
			m.log.Warn("bot wakeup refused (session gone or channel busy)")
		}
		return false
	}
	// Un Info par conversation : borne de corrélation pour tous les logs bot
	// qui suivent (échecs de publish, join raté, fallback Claude…).
	if m.log != nil {
		m.log.Info("bot started", "lang", userSess.Wants)
	}

	m.runBot(ctx, room, userSess, persona)
	return true
}

// runBot : boucle de chat côté bot. La room est déjà ouverte/abonnée par
// startBot. Attend le `join` du user, envoie un greeting, puis répond à
// chaque message via Claude. S'arrête quand le user quitte (Left) ou que le
// quota maxBotMessages est atteint.
func (m *BotManager) runBot(ctx context.Context, room *Room, userSess session.Session, p botPersona) {
	defer func() {
		sendCtx, c := context.WithTimeout(context.Background(), time.Second)
		// Un Left perdu = le user fixe un prof parti sans le savoir — à
		// défaut de retry (le user finira par quitter), on veut le voir.
		if err := room.SendLeft(sendCtx); err != nil && m.log != nil {
			m.log.Warn("bot left publish failed", "err", err)
		}
		_ = room.Close()
		c()
	}()

	// Canal d'évènements de la room — ouvert AVANT le greeting pour capter le
	// `join` du user. À n'appeler qu'UNE fois (chaque appel lance un reader).
	events := room.Channel()

	// On attend que le user ait rejoint la room avant de parler : sinon le
	// greeting partirait avant son abonnement et serait perdu (pub/sub ne
	// bufferise pas), d'où un prof IA muet. Fallback sur timeout si le `join`
	// est raté.
	if !m.waitForPeerJoin(ctx, events) {
		return
	}
	// Petite pause pour laisser le client afficher son ServerMatched avant
	// le premier message.
	select {
	case <-ctx.Done():
		return
	case <-time.After(botSettleDelay):
	}

	// Identité de quota prof IA : userID si connecté, sinon fingerprint.
	botQuotaID := quota.Identity(userSess.UserID, userSess.Fingerprint)

	// Quota déjà épuisé (Free) : on ouvre directement par le message de
	// limite (canned, pas d'appel Claude) puis on prend congé. Évite un chat
	// muet (le prof IA « ne se lance pas ») et ne brûle pas de tokens.
	if userSess.Plan != session.PlanPremium && m.quota != nil {
		if used, qerr := m.quota.Used(ctx, quota.KindBot, botQuotaID); qerr == nil && used >= quota.FreeBotDaily {
			m.sendBotMessage(ctx, room, "limit", botDailyLimitMsg(userSess.Wants))
			return
		}
	}

	history := make([]claudeapi.Message, 0, maxBotHistoryTurns*2)
	// Greeting de la persona (aucun appel Claude) : 1er message instantané,
	// TOUJOURS identique pour cette langue (peu importe que le prof soit assigné
	// par défaut ou choisi explicitement, connecté ou non), −1 appel par
	// conversation, et zéro risque d'ouverture muette si l'API est en panne (404
	// modèle / 5xx / timeout). On amorce l'historique avec un tour `user` (seed)
	// AVANT le greeting (`assistant`) : l'historique doit commencer par un
	// `user`, sinon le 1er vrai message formerait [assistant, user] → 400 et le
	// bot ne répondrait plus. Le seed donne aussi à Claude le contexte de son
	// ouverture pour la suite de l'échange.
	history = append(history,
		claudeapi.Message{Role: "user", Content: greetingSeed(userSess.Wants)},
		claudeapi.Message{Role: "assistant", Content: p.Greeting},
	)
	m.sendBotMessage(ctx, room, "greeting", p.Greeting)
	msgCount := 1

	for {
		select {
		case <-ctx.Done():
			return
		case env, ok := <-events:
			if !ok {
				return
			}
			switch env.Kind {
			case roomKindLeft:
				return
			case roomKindMsg:
				if msgCount >= maxBotMessages {
					m.sendBotMessage(ctx, room, "goodbye", goodbyeMsg(userSess.Wants))
					return
				}
				// Rafale : on draine les évènements déjà bufferisés AVANT de
				// consommer du quota et de payer un appel Claude. Si un Left y
				// figure (le user a fait Next/quitté pendant le tour
				// précédent), on sort tout de suite — sinon le bot répondrait
				// message par message dans une room morte, en gardant son slot
				// activeBots occupé (et le nouveau prof du même user compterait
				// double, jusqu'à saturer maxConcurrent sous charge). Les
				// messages drainés sont coalescés en un seul tour user → une
				// seule réponse pour la rafale, un seul appel API.
				bodies, left := drainPending(events, env.Body)
				if left {
					return
				}
				// Quota quotidien prof IA (Free = 50 msg/j ; Premium illimité).
				// Un crédit par message du user, rafale comprise — pas le
				// greeting. Dépassement → adieu + upsell Premium.
				quotaUsed := int64(0)
				if userSess.Plan != session.PlanPremium && m.quota != nil {
					for range bodies {
						_, qerr := m.quota.CheckAndIncrement(ctx, quota.KindBot, botQuotaID, quota.FreeBotDaily)
						if errors.Is(qerr, quota.ErrQuotaExceeded) {
							m.sendBotMessage(ctx, room, "limit", botDailyLimitMsg(userSess.Wants))
							return
						}
						if qerr != nil {
							// Redis indisponible : on log et on laisse passer
							// plutôt que de casser la conversation. Rien à
							// rembourser pour ce crédit non compté.
							if m.log != nil {
								m.log.Warn("bot quota incr", "err", qerr)
							}
							continue
						}
						quotaUsed++
					}
				}
				// CLAUDE.md règle d'or #2 : les bodies sont arrivés HTML-escaped
				// via moderation.SanitizeAndCheck côté sender. On les déchiffre
				// pour les envoyer en clair à Claude — sans logguer le contenu.
				userMsg := html.UnescapeString(strings.Join(bodies, "\n"))
				reply, err := m.callClaude(ctx, room, p.System, history, userMsg)
				if err != nil {
					// Échec malgré retries + jitter : l'API est vraiment en
					// difficulté. On rembourse les crédits consommés, on envoie
					// la réponse de repli et on prend congé (cf. bot_fallback.go)
					// — continuer ne produirait que des fallbacks en chaîne (qui
					// pollueraient aussi l'historique) en gardant le slot occupé.
					// Si ça arrive à CHAQUE conversation, c'est un souci de
					// clé/modèle Anthropic (et non la room).
					if m.log != nil {
						m.log.Warn("bot reply fell back (claude call failed)", "err", err)
					}
					if quotaUsed > 0 {
						refundCtx, rc := context.WithTimeout(context.Background(), time.Second)
						if rerr := m.quota.Refund(refundCtx, quota.KindBot, botQuotaID, quotaUsed); rerr != nil && m.log != nil {
							m.log.Warn("bot quota refund", "err", rerr)
						}
						rc()
					}
					m.sendBotMessage(ctx, room, "fallback", fallbackReply(userSess.Wants))
					return
				}
				history = appendHistory(history, claudeapi.Message{Role: "user", Content: userMsg})
				history = appendHistory(history, claudeapi.Message{Role: "assistant", Content: reply})
				m.sendBotMessage(ctx, room, "reply", reply)
				msgCount++
			}
		}
	}
}

// drainPending vide sans bloquer les évènements déjà bufferisés de la room et
// renvoie les corps de messages accumulés (le courant `current` inclus, dans
// l'ordre d'arrivée). left=true si un Left — ou la fermeture du canal — est en
// file : le user est déjà parti, le caller doit sortir sans payer d'appel
// Claude pour une room morte. Les typing/join drainés sont ignorés (le bot
// n'en fait rien pendant un tour de réponse).
func drainPending(events <-chan roomEnvelope, current string) (bodies []string, left bool) {
	bodies = []string{current}
	for {
		select {
		case env, ok := <-events:
			if !ok {
				return bodies, true
			}
			switch env.Kind {
			case roomKindLeft:
				return bodies, true
			case roomKindMsg:
				bodies = append(bodies, env.Body)
			}
		default:
			return bodies, false
		}
	}
}

// waitForPeerJoin attend que le user soit présent dans la room avant que le
// bot n'ouvre la conversation. Le user publie un `join` à l'ouverture de sa
// room ; tant qu'on ne l'a pas vu (ou un autre signe de vie : msg/typing), un
// greeting partirait potentiellement dans le vide. Renvoie false si le user
// quitte ou si le contexte est annulé avant. Fallback sur botJoinWait au cas
// où le `join` aurait été raté (le user est alors abonné depuis longtemps).
func (m *BotManager) waitForPeerJoin(ctx context.Context, events <-chan roomEnvelope) bool {
	timer := time.NewTimer(botJoinWait)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return false
		case <-timer.C:
			// Le greeting partira sans signe de vie du user — il est censé
			// être abonné depuis longtemps, mais si ce log précède un prof
			// muet, le `join` se perd quelque part.
			if m.log != nil {
				m.log.Warn("bot join signal missed, greeting on fallback timer")
			}
			return true
		case env, ok := <-events:
			if !ok {
				if m.log != nil {
					m.log.Warn("bot room channel closed before peer join")
				}
				return false
			}
			switch env.Kind {
			case roomKindLeft:
				if m.log != nil {
					m.log.Info("peer left before bot greeting")
				}
				return false
			case roomKindJoin, roomKindMsg, roomKindTyping:
				return true
			}
		}
	}
}

// callClaude : envoie le message du user à Claude tout en émettant un signal
// "typing" au peer pour que l'UI affiche les 3 points pendant la latence (~1s
// sur Haiku 4.5). Ajoute aussi un jitter humain 800-1500ms après réponse.
// N'est appelée QUE pour répondre à un vrai message du user — le greeting
// d'ouverture part en dur depuis runBot (persona.Greeting), jamais via Claude.
func (m *BotManager) callClaude(ctx context.Context, room *Room, system string, history []claudeapi.Message, userMsg string) (string, error) {
	typingCtx, typingCancel := context.WithCancel(ctx)
	defer typingCancel()
	go func() {
		t := time.NewTicker(1500 * time.Millisecond)
		defer t.Stop()
		_ = room.SendTyping(typingCtx)
		for {
			select {
			case <-typingCtx.Done():
				return
			case <-t.C:
				_ = room.SendTyping(typingCtx)
			}
		}
	}()

	reply, err := m.claude.Reply(ctx, system, history, userMsg)
	if err != nil {
		return "", err
	}

	// Jitter humain pour ne pas répondre "trop vite" et casser l'illusion.
	delay := time.Duration(800+rand.Intn(700)) * time.Millisecond
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case <-time.After(delay):
	}
	return reply, nil
}

// sendBotMessage : escape HTML (invariant règle d'or #2) puis publish, avec
// UN retry sur échec — pub/sub ne rejoue jamais un publish raté, et pour le
// greeting un raté = prof IA définitivement muet. `kind` n'alimente que les
// logs (greeting/reply/goodbye/limit/fallback) — jamais le contenu (règle
// d'or #1). On évite d'appeler moderation.SanitizeAndCheck — pas de
// blocklist pertinente pour la sortie d'une IA prof.
func (m *BotManager) sendBotMessage(ctx context.Context, room *Room, kind, body string) {
	_ = ctx // contexte parent ignoré pour le SendMsg — on veut envoyer même si
	// le parent est en train d'être annulé pour propager le goodbye.
	id := uuid.NewString() // même ID sur les 2 tentatives : c'est le même message
	escaped := html.EscapeString(body)
	for attempt := 1; attempt <= 2; attempt++ {
		sendCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		err := room.SendMsg(sendCtx, id, escaped)
		cancel()
		if err == nil {
			return
		}
		if m.log != nil {
			m.log.Warn("bot message publish failed", "kind", kind, "attempt", attempt, "err", err)
		}
	}
}

// appendHistory : ajoute un tour et cap la taille à maxBotHistoryTurns*2.
func appendHistory(h []claudeapi.Message, m claudeapi.Message) []claudeapi.Message {
	h = append(h, m)
	if len(h) > maxBotHistoryTurns*2 {
		h = h[len(h)-maxBotHistoryTurns*2:]
	}
	return h
}

// greetingSeed : instruction passée à Claude pour le tout premier message.
// L'historique étant vide, Claude a juste le system prompt + cette
// instruction pour démarrer naturellement.
func greetingSeed(lang string) string {
	switch lang {
	case "fr":
		return "Démarre la conversation : salue chaleureusement l'apprenant, présente-toi en une phrase, et pose-lui une question ouverte pour briser la glace."
	case "es":
		return "Inicia la conversación: saluda cálidamente al estudiante, preséntate en una frase y hazle una pregunta abierta para romper el hielo."
	case "de":
		return "Beginne das Gespräch: Begrüße den Lernenden herzlich, stelle dich in einem Satz vor und stelle eine offene Frage, um das Eis zu brechen."
	case "pt":
		return "Inicia a conversa: cumprimenta calorosamente o aluno, apresenta-te numa frase e faz-lhe uma pergunta aberta para quebrar o gelo."
	case "it":
		return "Inizia la conversazione: saluta calorosamente lo studente, presentati in una frase e fagli una domanda aperta per rompere il ghiaccio."
	case "zh":
		return "开始对话：热情地问候学习者，用一句话介绍自己，并提一个开放式问题来打破僵局。"
	case "ja":
		return "会話を始めてください：学習者に温かくあいさつし、一文で自己紹介をして、打ち解けるための自由に答えられる質問をしてください。"
	case "ko":
		return "대화를 시작하세요: 학습자에게 따뜻하게 인사하고, 한 문장으로 자신을 소개한 뒤, 분위기를 풀 수 있는 열린 질문을 하나 던지세요."
	case "ar":
		return "ابدئي المحادثة: حيّي المتعلّم بحرارة، وعرّفي بنفسك في جملة واحدة، واطرحي عليه سؤالًا مفتوحًا لكسر الجمود."
	default:
		return "Start the conversation: warmly greet the learner, briefly introduce yourself in one sentence, and ask an open question to break the ice."
	}
}
