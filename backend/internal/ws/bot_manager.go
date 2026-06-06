package ws

import (
	"context"
	"errors"
	"html"
	"log/slog"
	"math/rand"
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
	// plus récents). 20 paires = 40 messages.
	maxBotHistoryTurns = 20
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

	// Quota prof IA épuisé (Free) : on n'arme pas un bot de repli qui
	// dirait aussitôt « limite atteinte ». On laisse le user en queue —
	// un match humain reste possible, sinon il sortira sur queue_timeout.
	if userSess.Plan != session.PlanPremium && m.quota != nil {
		id := quota.Identity(userSess.UserID, userSess.Fingerprint)
		if used, err := m.quota.Used(ctx, quota.KindBot, id); err == nil && used >= quota.FreeBotDaily {
			return
		}
	}

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

	if !m.hub.Wakeup(userSess.ID, WakeupEvent{
		RoomID:   roomID,
		PeerNick: persona.Name,
		PeerID:   botPeerID,
		IsBot:    true,
	}) {
		return false
	}

	m.runBot(ctx, roomID, botPeerID, userSess, persona)
	return true
}

// runBot : boucle de chat côté bot. Subscribe à la room, envoie un
// greeting après un court délai, puis répond à chaque message du user
// via Claude. S'arrête quand le user quitte (Left) ou que le quota
// maxBotMessages est atteint.
func (m *BotManager) runBot(ctx context.Context, roomID, botPeerID string, userSess session.Session, p botPersona) {
	room, err := openRoom(ctx, m.rdb, roomID, botPeerID)
	if err != nil {
		if m.log != nil {
			m.log.Warn("bot open room", "err", err)
		}
		return
	}
	defer func() {
		sendCtx, c := context.WithTimeout(context.Background(), time.Second)
		_ = room.SendLeft(sendCtx)
		_ = room.Close()
		c()
	}()

	// Greeting : on laisse le client afficher d'abord son ServerMatched
	// (~200ms), puis on envoie un premier message comme si on amorçait
	// la conversation.
	time.Sleep(1200 * time.Millisecond)

	// Identité de quota prof IA : userID si connecté, sinon fingerprint.
	botQuotaID := quota.Identity(userSess.UserID, userSess.Fingerprint)

	history := make([]claudeapi.Message, 0, maxBotHistoryTurns*2)
	greeting, err := m.callClaude(ctx, room, p.System, history, "", userSess.Wants)
	if err == nil && greeting != "" {
		history = append(history, claudeapi.Message{Role: "assistant", Content: greeting})
		m.sendBotMessage(ctx, room, greeting)
	}
	msgCount := 1

	events := room.Channel()
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
					m.sendBotMessage(ctx, room, goodbyeMsg(userSess.Wants))
					return
				}
				// Quota quotidien prof IA (Free = 50 msg/j ; Premium illimité).
				// On compte chaque message du user auquel on répond — pas le
				// greeting. Dépassement → adieu + upsell Premium.
				if userSess.Plan != session.PlanPremium && m.quota != nil {
					_, qerr := m.quota.CheckAndIncrement(ctx, quota.KindBot, botQuotaID, quota.FreeBotDaily)
					if errors.Is(qerr, quota.ErrQuotaExceeded) {
						m.sendBotMessage(ctx, room, botDailyLimitMsg(userSess.Wants))
						return
					}
					if qerr != nil && m.log != nil {
						// Redis indisponible : on log et on laisse passer plutôt
						// que de casser la conversation.
						m.log.Warn("bot quota incr", "err", qerr)
					}
				}
				// CLAUDE.md règle d'or #2 : le body est arrivé HTML-escaped
				// via moderation.SanitizeAndCheck côté sender. On le
				// déchiffre pour l'envoyer en clair à Claude — sans logguer
				// le contenu.
				userMsg := html.UnescapeString(env.Body)
				reply, err := m.callClaude(ctx, room, p.System, history, userMsg, userSess.Wants)
				if err != nil {
					reply = fallbackReply(userSess.Wants)
				}
				history = appendHistory(history, claudeapi.Message{Role: "user", Content: userMsg})
				history = appendHistory(history, claudeapi.Message{Role: "assistant", Content: reply})
				m.sendBotMessage(ctx, room, reply)
				msgCount++
			}
		}
	}
}

// callClaude : envoie l'appel à Claude tout en émettant un signal "typing"
// au peer pour que l'UI affiche les 3 points pendant la latence (~1s sur
// Haiku 4.5). Ajoute aussi un jitter humain 800-1500ms après réponse.
func (m *BotManager) callClaude(ctx context.Context, room *Room, system string, history []claudeapi.Message, userMsg, targetLang string) (string, error) {
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

	prompt := userMsg
	if prompt == "" {
		// Cas du greeting initial — on demande à Claude d'ouvrir.
		prompt = greetingSeed(targetLang)
	}
	reply, err := m.claude.Reply(ctx, system, history, prompt)
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

// sendBotMessage : escape HTML (invariant règle d'or #2) puis publish.
// On évite d'appeler moderation.SanitizeAndCheck — pas de blocklist
// pertinente pour la sortie d'une IA prof.
func (m *BotManager) sendBotMessage(ctx context.Context, room *Room, body string) {
	sendCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = ctx // contexte parent ignoré pour le SendMsg — on veut envoyer même si
	// le parent est en train d'être annulé pour propager le goodbye.
	_ = room.SendMsg(sendCtx, uuid.NewString(), html.EscapeString(body))
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
