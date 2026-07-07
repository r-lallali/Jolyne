package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/admin"
	"github.com/ralys/jolyne/backend/internal/analytics"
	"github.com/ralys/jolyne/backend/internal/billing"
	"github.com/ralys/jolyne/backend/internal/friends"
	"github.com/ralys/jolyne/backend/internal/grammar"
	"github.com/ralys/jolyne/backend/internal/learn"
	"github.com/ralys/jolyne/backend/internal/matcher"
	"github.com/ralys/jolyne/backend/internal/metrics"
	"github.com/ralys/jolyne/backend/internal/profile"
	"github.com/ralys/jolyne/backend/internal/push"
	"github.com/ralys/jolyne/backend/internal/quota"
	"github.com/ralys/jolyne/backend/internal/translate"
	"github.com/ralys/jolyne/backend/internal/users"
	"github.com/ralys/jolyne/backend/internal/vocab"
	"github.com/ralys/jolyne/backend/internal/ws"
)

// services regroupe les dépendances utilisées par les handlers HTTP.
type services struct {
	rdb             *redis.Client
	pg              *pgxpool.Pool // nil si POSTGRES_DSN non renseigné
	wsHandler       *ws.Handler
	wsFriendHandler *ws.FriendHandler // nil si auth user / friends désactivés
	wsInboxHandler  *ws.InboxHandler  // nil si auth user / friends désactivés
	admin           *admin.Handlers   // nil si back-office désactivé
	translate       *translate.Handler
	grammar         *grammar.Handler
	quota           *quota.Handler    // état des compteurs (toujours présent)
	billing         *billing.Handlers // nil si Stripe non configuré
	users           *users.Handlers   // nil si auth utilisateur désactivée
	profile         *profile.Handlers // nil si auth utilisateur désactivée
	friends         *friends.Handlers // nil si auth utilisateur désactivée
	vocab           *vocab.Handlers   // nil si auth utilisateur désactivée
	learn           *learn.Handlers   // nil si auth utilisateur désactivée
	push            *push.Handlers    // nil si VAPID env manquant
	publicCORS      string            // origin autorisée pour /api/translate et /api/grammar
	beacon          *analytics.Beacon // nil si Postgres absent — events analytics front
	metrics         *metrics.Metrics  // nil si désactivé — endpoint Prometheus /metrics
	metricsAllow    []*net.IPNet      // IP allowlist protégeant /metrics (= allowlist admin)
}

func routes(s services) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", healthz(s))
	mux.Handle("GET /ws/match", s.wsHandler)
	if s.wsFriendHandler != nil {
		mux.Handle("GET /ws/friend/", s.wsFriendHandler)
	}
	if s.wsInboxHandler != nil {
		mux.Handle("GET /ws/inbox", s.wsInboxHandler)
	}
	mux.Handle("/api/queue-size", publicCORS(s.publicCORS)(http.HandlerFunc(queueSize(s.rdb))))
	if s.quota != nil {
		mux.Handle("/api/quota", publicCORS(s.publicCORS)(methodOnly("GET", s.quota)))
	}

	// Beacon analytics public (page_view, signup_started, match_search_started).
	// Monté seulement si Postgres est présent (sinon le Tracker est nil).
	if s.beacon != nil {
		mux.Handle("/api/events", publicCORS(s.publicCORS)(methodOnly("POST", s.beacon.Handler())))
	}

	// Endpoint Prometheus, protégé par l'IP allowlist admin (404 sinon, comme
	// le back-office). On n'expose /metrics QUE si une allowlist est configurée —
	// sinon il serait public (admin.IPAllowed laisse passer si la liste est vide).
	if s.metrics != nil && len(s.metricsAllow) > 0 {
		mux.Handle("GET /metrics", metricsGuard(s.metricsAllow, s.metrics.Handler()))
	}

	if s.translate != nil {
		mux.Handle("/api/translate", publicCORS(s.publicCORS)(s.translate))
	}
	if s.grammar != nil {
		mux.Handle("/api/grammar", publicCORS(s.publicCORS)(s.grammar))
	}

	// Billing Premium (Stripe). Routes montées dès qu'on a l'auth user : si
	// Stripe n'est pas configuré, le handler renvoie 503 (AVEC CORS) au lieu
	// d'un 404 muet — sinon le navigateur voit une erreur CORS trompeuse. Même
	// approche que les routes notifications/push. checkout/portal exigent
	// l'auth ; webhook est public mais authentifié par la signature Stripe
	// (corps brut lu dans le handler — aucun middleware ne consomme le body).
	if s.users != nil {
		auth := s.users.RequireAuth
		cors := publicCORS(s.publicCORS)
		guard := func(h func(http.ResponseWriter, *http.Request)) http.HandlerFunc {
			return func(w http.ResponseWriter, r *http.Request) {
				if s.billing == nil {
					http.Error(w, "billing disabled", http.StatusServiceUnavailable)
					return
				}
				h(w, r)
			}
		}
		mux.Handle("/api/billing/checkout", cors(auth(methodOnly("POST", guard(func(w http.ResponseWriter, r *http.Request) { s.billing.HandleCheckout(w, r) })))))
		mux.Handle("/api/billing/portal", cors(auth(methodOnly("POST", guard(func(w http.ResponseWriter, r *http.Request) { s.billing.HandlePortal(w, r) })))))
		mux.Handle("/api/billing/webhook", methodOnly("POST", guard(func(w http.ResponseWriter, r *http.Request) { s.billing.HandleWebhook(w, r) })))
	}

	if s.users != nil {
		mux.Handle("/api/auth/signup", publicCORS(s.publicCORS)(methodOnly("POST", http.HandlerFunc(s.users.HandleSignup))))
		mux.Handle("/api/auth/login", publicCORS(s.publicCORS)(methodOnly("POST", http.HandlerFunc(s.users.HandleLogin))))
		mux.Handle("/api/auth/verify-email", publicCORS(s.publicCORS)(methodOnly("POST", http.HandlerFunc(s.users.HandleVerifyEmail))))
		mux.Handle("/api/auth/forgot", publicCORS(s.publicCORS)(methodOnly("POST", http.HandlerFunc(s.users.HandleForgot))))
		mux.Handle("/api/auth/reset", publicCORS(s.publicCORS)(methodOnly("POST", http.HandlerFunc(s.users.HandleReset))))
		mux.Handle("/api/auth/logout", publicCORS(s.publicCORS)(methodOnly("POST", http.HandlerFunc(s.users.HandleLogout))))
		mux.Handle("/api/auth/me", publicCORS(s.publicCORS)(methodOnly("GET", http.HandlerFunc(s.users.HandleMe))))
	}

	if s.profile != nil && s.users != nil {
		// Toutes les routes /api/account/* requièrent l'auth user via le
		// middleware RequireAuth des handlers users.
		auth := s.users.RequireAuth
		cors := publicCORS(s.publicCORS)
		// Config publique Cloudinary (cloud_name uniquement) — pas d'auth
		// pour pouvoir afficher les photos avant login.
		mux.Handle("/api/account/cloudinary-config",
			cors(methodOnly("GET", http.HandlerFunc(s.profile.HandleCloudConfig))))
		// /api/account : GET ou PUT le profile + photos courant.
		mux.Handle("/api/account", cors(auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet:
				s.profile.HandleGet(w, r)
			case http.MethodPut:
				s.profile.HandlePut(w, r)
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			}
		}))))
		mux.Handle("/api/account/verify",
			cors(auth(methodOnly("POST", http.HandlerFunc(s.profile.HandleVerify)))))
		mux.Handle("/api/account/photos/sign",
			cors(auth(methodOnly("POST", http.HandlerFunc(s.profile.HandleSignPhotoUpload)))))
		mux.Handle("/api/account/photos/reorder",
			cors(auth(methodOnly("PUT", http.HandlerFunc(s.profile.HandleReorderPhotos)))))
		mux.Handle("/api/account/photos",
			cors(auth(methodOnly("POST", http.HandlerFunc(s.profile.HandleSetPhoto)))))
		// DELETE /api/account/photos/{position}
		mux.Handle("/api/account/photos/", cors(auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodDelete {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			s.profile.HandleDeletePhoto(w, r)
		}))))
	}

	if s.friends != nil && s.users != nil {
		auth := s.users.RequireAuth
		cors := publicCORS(s.publicCORS)
		mux.Handle("/api/friends", cors(auth(methodOnly("GET", http.HandlerFunc(s.friends.HandleList)))))
		// `/api/friends/{id}` (DELETE), `/api/friends/{id}/messages`
		// (GET/POST), `/api/friends/{id}/profile` (GET).
		mux.Handle("/api/friends/", cors(auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			switch {
			case strings.HasSuffix(path, "/messages") && r.Method == http.MethodGet:
				s.friends.HandleGetMessages(w, r)
			case strings.HasSuffix(path, "/messages") && r.Method == http.MethodPost:
				s.friends.HandlePostMessage(w, r)
			case strings.HasSuffix(path, "/profile") && r.Method == http.MethodGet:
				s.friends.HandleGetProfile(w, r)
			case strings.HasSuffix(path, "/report") && r.Method == http.MethodPost:
				s.friends.HandleReport(w, r)
			case strings.HasSuffix(path, "/streak/restore") && r.Method == http.MethodPost:
				s.friends.HandleRestoreStreak(w, r)
			case r.Method == http.MethodDelete &&
				!strings.HasSuffix(path, "/messages") &&
				!strings.HasSuffix(path, "/profile") &&
				!strings.HasSuffix(path, "/report") &&
				!strings.HasSuffix(path, "/streak/restore"):
				s.friends.HandleRemove(w, r)
			default:
				http.NotFound(w, r)
			}
		}))))
	}

	// Carnet de vocabulaire. Toutes les routes requièrent l'auth user.
	// `/api/vocab` (GET liste, POST création) ; `/api/vocab/review` (GET pile
	// de cartes dues) ; `/api/vocab/{id}` (DELETE) ;
	// `/api/vocab/{id}/review` (POST note SM-2).
	if s.vocab != nil && s.users != nil {
		auth := s.users.RequireAuth
		cors := publicCORS(s.publicCORS)
		mux.Handle("/api/vocab", cors(auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet:
				s.vocab.HandleList(w, r)
			case http.MethodPost:
				s.vocab.HandleCreate(w, r)
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			}
		}))))
		// Route exacte prioritaire sur le subtree `/api/vocab/` (ServeMux).
		mux.Handle("/api/vocab/review", cors(auth(methodOnly("GET", http.HandlerFunc(s.vocab.HandleReviewList)))))
		mux.Handle("/api/vocab/", cors(auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/review"):
				s.vocab.HandleReviewGrade(w, r)
			case r.Method == http.MethodDelete && !strings.HasSuffix(r.URL.Path, "/review"):
				s.vocab.HandleDelete(w, r)
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			}
		}))))
	}

	// Mode Cours. Toutes les routes requièrent l'auth user (progression +
	// streak liés au compte).
	//   GET  /api/learn/courses                       liste des cours
	//   GET  /api/learn/courses/{lang}                arbre + progression
	//   GET  /api/learn/lessons/{id}?from=fr          items résolus pour jouer
	//   POST /api/learn/lessons/{id}/complete         valide la leçon
	//   GET  /api/learn/state                         état de gamification
	//   PUT  /api/learn/state/daily-goal              règle l'objectif quotidien
	//   POST /api/learn/courses/{lang}/placement      choix du niveau de départ
	//   POST /api/learn/hearts/request                demande un cœur à un ami
	//   GET  /api/learn/hearts/requests               demandes de cœur reçues
	//   POST /api/learn/hearts/requests/{id}/grant    accorde un cœur
	if s.learn != nil && s.users != nil {
		auth := s.users.RequireAuth
		cors := publicCORS(s.publicCORS)
		// Leçon du jour : fautes corrigées à rejouer (analyse IA post-chat).
		mux.Handle("/api/learn/daily", cors(auth(methodOnly("GET", http.HandlerFunc(s.learn.HandleDaily)))))
		mux.Handle("/api/learn/daily/complete", cors(auth(methodOnly("POST", http.HandlerFunc(s.learn.HandleDailyComplete)))))
		mux.Handle("/api/learn/courses", cors(auth(methodOnly("GET", http.HandlerFunc(s.learn.HandleListCourses)))))
		// Sous-arbre /api/learn/courses/{lang}[/placement] — dispatch par méthode/suffixe.
		mux.Handle("/api/learn/courses/", cors(auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/placement"):
				s.learn.HandlePlacement(w, r)
			case r.Method == http.MethodGet && !strings.HasSuffix(r.URL.Path, "/placement"):
				s.learn.HandleTree(w, r)
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			}
		}))))
		mux.Handle("/api/learn/state", cors(auth(methodOnly("GET", http.HandlerFunc(s.learn.HandleState)))))
		mux.Handle("/api/learn/state/daily-goal", cors(auth(methodOnly("PUT", http.HandlerFunc(s.learn.HandleSetGoal)))))
		mux.Handle("/api/learn/hearts/request", cors(auth(methodOnly("POST", http.HandlerFunc(s.learn.HandleRequestHeart)))))
		mux.Handle("/api/learn/hearts/requests", cors(auth(methodOnly("GET", http.HandlerFunc(s.learn.HandleListHeartRequests)))))
		// Sous-arbre /api/learn/hearts/requests/{id}/grant.
		mux.Handle("/api/learn/hearts/requests/", cors(auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/grant") {
				s.learn.HandleGrantHeart(w, r)
				return
			}
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}))))
		// Sous-arbre /api/learn/lessons/{id}[/complete] — dispatch par suffixe.
		mux.Handle("/api/learn/lessons/", cors(auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/complete"):
				s.learn.HandleComplete(w, r)
			case r.Method == http.MethodGet && !strings.HasSuffix(r.URL.Path, "/complete"):
				s.learn.HandleLessonPlay(w, r)
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			}
		}))))
	}

	// Routes notifications enregistrées dès qu'on a l'auth user. Si VAPID
	// n'est pas configuré côté backend, le handler renvoie 503 (avec CORS)
	// au lieu d'un 404 muet qui génère une erreur CORS bruyante côté front.
	if s.users != nil {
		auth := s.users.RequireAuth
		cors := publicCORS(s.publicCORS)
		mux.Handle("/api/notifications/vapid-public-key", cors(methodOnly("GET", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if s.push == nil {
				http.Error(w, "push disabled", http.StatusServiceUnavailable)
				return
			}
			s.push.HandleVAPIDPublicKey(w, r)
		}))))
		mux.Handle("/api/notifications/subscribe", cors(auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if s.push == nil {
				http.Error(w, "push disabled", http.StatusServiceUnavailable)
				return
			}
			switch r.Method {
			case http.MethodPost:
				s.push.HandleSubscribe(w, r)
			case http.MethodDelete:
				s.push.HandleUnsubscribe(w, r)
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			}
		}))))
	}

	if s.admin != nil {
		mountAdmin(mux, s.admin)
	}

	// Le middleware Prometheus enveloppe tout le mux (volume + latence par
	// route). Transparent vis-à-vis du WS grâce au statusWriter hijackable.
	if s.metrics != nil {
		return s.metrics.Middleware(mux)
	}
	return mux
}

// metricsGuard restreint /metrics à l'IP allowlist admin. Hors allowlist →
// 404 (on ne révèle pas l'endpoint), cohérent avec le back-office.
func metricsGuard(allow []*net.IPNet, h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !admin.IPAllowed(r, allow) {
			http.NotFound(w, r)
			return
		}
		h.ServeHTTP(w, r)
	})
}

// queueSize renvoie le nombre de peers déjà en attente qui matchent
// (speaks=wants, wants=speaks). Public — la valeur n'est ni sensible ni
// fine (LLEN, race acceptée). Aucun quota au lancement.
func queueSize(rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		q := r.URL.Query()
		speaks := matcher.LangCode(q.Get("speaks"))
		wants := matcher.LangCode(q.Get("wants"))
		if err := matcher.ValidatePair(speaks, wants); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 500*time.Millisecond)
		defer cancel()
		n, err := rdb.ZCard(ctx, matcher.QueueTargetKey(speaks, wants)).Result()
		if err != nil {
			http.Error(w, "queue size unavailable", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]int64{"count": n})
	}
}

// publicCORS autorise un seul origin (le frontend public). credentials=true
// pour que le cookie de session user soit envoyé sur /api/auth/me. Si
// `origin` est vide, on n'ajoute aucun header — utile en dev local où le
// frontend tape directement le backend sans cross-origin.
func publicCORS(origin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			reqOrigin := r.Header.Get("Origin")
			if origin != "" && reqOrigin == origin {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Device-FP")
				w.Header().Set("Vary", "Origin")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// mountAdmin enregistre les endpoints /api/admin/* SANS contrainte de
// méthode — le CORS middleware intercepte OPTIONS, chaque handler vérifie
// la méthode requise et renvoie 405 si inadaptée. Plus déterministe que
// la combo `POST /path` + `OPTIONS /sub/`.
func mountAdmin(mux *http.ServeMux, h *admin.Handlers) {
	cors := admin.CORSMiddleware(h.Cfg)
	auth := admin.AuthMiddleware(h.Cfg)

	mux.Handle("/api/admin/login", cors(methodOnly("POST", http.HandlerFunc(h.HandleLogin))))
	mux.Handle("/api/admin/logout", cors(methodOnly("POST", http.HandlerFunc(h.HandleLogout))))
	mux.Handle("/api/admin/me", cors(auth(methodOnly("GET", http.HandlerFunc(h.HandleMe)))))
	mux.Handle("/api/admin/reports", cors(auth(methodOnly("GET", http.HandlerFunc(h.HandleListReports)))))

	// Subtree /api/admin/reports/{id}[/resolve|/reopen|/ban] — dispatch
	// par méthode + suffix.
	mux.Handle("/api/admin/reports/", cors(auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		switch {
		case r.Method == http.MethodGet && !hasAnySuffix(path, "/resolve", "/reopen", "/ban"):
			h.HandleGetReport(w, r)
		case r.Method == http.MethodPost && strings.HasSuffix(path, "/resolve"):
			h.HandleResolveReport(w, r)
		case r.Method == http.MethodPost && strings.HasSuffix(path, "/reopen"):
			h.HandleReopenReport(w, r)
		case r.Method == http.MethodPost && strings.HasSuffix(path, "/ban"):
			h.HandleBanFromReport(w, r)
		default:
			http.NotFound(w, r)
		}
	}))))

	mux.Handle("/api/admin/bans", cors(auth(methodOnly("GET", http.HandlerFunc(h.HandleListBans)))))
	mux.Handle("/api/admin/bans/", cors(auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/lift") {
			h.HandleLiftBan(w, r)
			return
		}
		http.NotFound(w, r)
	}))))

	// Dashboards analytics (lecture). Tout sous /api/admin/stats/*.
	mux.Handle("/api/admin/stats/overview", cors(auth(methodOnly("GET", http.HandlerFunc(h.HandleStatsOverview)))))
	mux.Handle("/api/admin/stats/funnel", cors(auth(methodOnly("GET", http.HandlerFunc(h.HandleStatsFunnel)))))
	mux.Handle("/api/admin/stats/retention", cors(auth(methodOnly("GET", http.HandlerFunc(h.HandleStatsRetention)))))
	mux.Handle("/api/admin/stats/timeseries", cors(auth(methodOnly("GET", http.HandlerFunc(h.HandleStatsTimeSeries)))))
	mux.Handle("/api/admin/stats/engagement", cors(auth(methodOnly("GET", http.HandlerFunc(h.HandleStatsEngagement)))))
	mux.Handle("/api/admin/stats/revenue", cors(auth(methodOnly("GET", http.HandlerFunc(h.HandleStatsRevenue)))))
	mux.Handle("/api/admin/stats/server", cors(auth(methodOnly("GET", http.HandlerFunc(h.HandleStatsServer)))))
	mux.Handle("/api/admin/stats/audit", cors(auth(methodOnly("GET", http.HandlerFunc(h.HandleAudit)))))
	mux.Handle("/api/admin/stats/users", cors(auth(methodOnly("GET", http.HandlerFunc(h.HandleUsersList)))))
	// Sous-arbre /api/admin/stats/users/{id}[/premium|/ban|/data] — GET/POST/DELETE.
	mux.Handle("/api/admin/stats/users/", cors(auth(http.HandlerFunc(h.HandleUsersSubtree))))
}

func hasAnySuffix(s string, suffixes ...string) bool {
	for _, suf := range suffixes {
		if strings.HasSuffix(s, suf) {
			return true
		}
	}
	return false
}

// methodOnly renvoie 405 pour toute méthode autre que celle attendue.
// OPTIONS est laissé passer pour ne pas court-circuiter le CORS middleware
// (qui répond 204 lui-même).
func methodOnly(method string, h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			h.ServeHTTP(w, r)
			return
		}
		if r.Method != method {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.ServeHTTP(w, r)
	})
}

// healthz pingue Redis et Postgres (si configuré). 200 si tout va, 503 sinon.
func healthz(s services) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status := map[string]string{"status": "ok"}
		code := http.StatusOK

		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()

		if err := s.rdb.Ping(ctx).Err(); err != nil {
			status["status"] = "degraded"
			status["redis"] = err.Error()
			code = http.StatusServiceUnavailable
		}

		if s.pg != nil {
			if err := s.pg.Ping(ctx); err != nil {
				status["status"] = "degraded"
				status["postgres"] = err.Error()
				code = http.StatusServiceUnavailable
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(status)
	}
}
