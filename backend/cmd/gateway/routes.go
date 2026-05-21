package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/admin"
	"github.com/ralys/jolyne/backend/internal/friends"
	"github.com/ralys/jolyne/backend/internal/grammar"
	"github.com/ralys/jolyne/backend/internal/matcher"
	"github.com/ralys/jolyne/backend/internal/profile"
	"github.com/ralys/jolyne/backend/internal/translate"
	"github.com/ralys/jolyne/backend/internal/users"
	"github.com/ralys/jolyne/backend/internal/ws"
)

// services regroupe les dépendances utilisées par les handlers HTTP.
type services struct {
	rdb             *redis.Client
	pg              *pgxpool.Pool // nil si POSTGRES_DSN non renseigné
	wsHandler       *ws.Handler
	wsFriendHandler *ws.FriendHandler // nil si auth user / friends désactivés
	admin           *admin.Handlers   // nil si back-office désactivé
	translate       *translate.Handler
	grammar         *grammar.Handler
	users           *users.Handlers   // nil si auth utilisateur désactivée
	profile         *profile.Handlers // nil si auth utilisateur désactivée
	friends         *friends.Handlers // nil si auth utilisateur désactivée
	publicCORS      string            // origin autorisée pour /api/translate et /api/grammar
}

func routes(s services) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", healthz(s))
	mux.Handle("GET /ws/match", s.wsHandler)
	if s.wsFriendHandler != nil {
		mux.Handle("GET /ws/friend/", s.wsFriendHandler)
	}
	mux.Handle("/api/queue-size", publicCORS(s.publicCORS)(http.HandlerFunc(queueSize(s.rdb))))

	if s.translate != nil {
		mux.Handle("/api/translate", publicCORS(s.publicCORS)(s.translate))
	}
	if s.grammar != nil {
		mux.Handle("/api/grammar", publicCORS(s.publicCORS)(s.grammar))
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
		mux.Handle("/api/account/photos/sign",
			cors(auth(methodOnly("POST", http.HandlerFunc(s.profile.HandleSignPhotoUpload)))))
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
			case r.Method == http.MethodDelete &&
				!strings.HasSuffix(path, "/messages") &&
				!strings.HasSuffix(path, "/profile") &&
				!strings.HasSuffix(path, "/report"):
				s.friends.HandleRemove(w, r)
			default:
				http.NotFound(w, r)
			}
		}))))
	}

	if s.admin != nil {
		mountAdmin(mux, s.admin)
	}
	return mux
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
		n, err := rdb.LLen(ctx, matcher.QueueTargetKey(speaks, wants)).Result()
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
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
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
