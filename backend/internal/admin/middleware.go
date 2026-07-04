package admin

import (
	"context"
	"net"
	"net/http"
	"strings"

	"github.com/ralys/jolyne/backend/internal/netx"
)

type ctxKey int

const ctxKeyAdmin ctxKey = iota

// Config regroupe tout ce qui pilote le comportement admin.
type Config struct {
	Users         []User
	IPAllowlist   []*net.IPNet
	SessionSecret []byte
	CookieDomain  string // ex: "ralys.ovh" pour partager entre subdomains
	CookieSecure  bool   // toujours true en prod
	CORSOrigin    string // ex: "https://jolyne.ralys.ovh"
	// PremiumMonthlyCents : prix mensuel Premium (centimes) pour estimer le MRR
	// dans le dashboard revenus. 0 = MRR non calculé (affiche juste le compte).
	PremiumMonthlyCents int64
}

// AuthMiddleware vérifie :
//   - IP du client dans l'allowlist (si configurée)
//   - cookie de session valide
//
// Échec → 404 (et NON 401) pour ne pas révéler l'existence du back-office
// à un attaquant sans le bon IP/session. Voir CLAUDE.md §"Back-office".
func AuthMiddleware(cfg Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !ipAllowed(r, cfg.IPAllowlist) {
				http.NotFound(w, r)
				return
			}
			cookie, err := r.Cookie(SessionCookieName)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			sess, err := VerifySession(cookie.Value, cfg.SessionSecret)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			ctx := context.WithValue(r.Context(), ctxKeyAdmin, sess)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// CORSMiddleware autorise UNIQUEMENT le frontend connu (ADMIN_CORS_ORIGIN)
// avec credentials. Tout autre origin est ignoré.
func CORSMiddleware(cfg Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if cfg.CORSOrigin != "" && origin == cfg.CORSOrigin {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
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

// SessionFromContext renvoie la session admin (set par AuthMiddleware).
func SessionFromContext(ctx context.Context) (Session, bool) {
	s, ok := ctx.Value(ctxKeyAdmin).(Session)
	return s, ok
}

// IPAllowed est exporté pour utilisation hors middleware (login endpoint).
func IPAllowed(r *http.Request, allowlist []*net.IPNet) bool {
	return ipAllowed(r, allowlist)
}

// ParseIPAllowlist parse une CSV `1.2.3.4,10.0.0.0/8,2001:db8::/32`.
// Une chaîne vide signifie "pas d'allowlist, tout passe" — à ne JAMAIS
// utiliser en prod.
func ParseIPAllowlist(raw string) ([]*net.IPNet, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var nets []*net.IPNet
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		// IP simple → CIDR /32 ou /128
		if !strings.Contains(part, "/") {
			ip := net.ParseIP(part)
			if ip == nil {
				return nil, &net.ParseError{Type: "IP", Text: part}
			}
			bits := 32
			if ip.To4() == nil {
				bits = 128
			}
			part = part + "/" + itoa(bits)
		}
		_, cidr, err := net.ParseCIDR(part)
		if err != nil {
			return nil, err
		}
		nets = append(nets, cidr)
	}
	return nets, nil
}

func ipAllowed(r *http.Request, allowlist []*net.IPNet) bool {
	// allowlist vide = ouvert. Acceptable seulement en dev.
	if len(allowlist) == 0 {
		return true
	}
	ipStr := clientIP(r)
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return false
	}
	for _, cidr := range allowlist {
		if cidr.Contains(ip) {
			return true
		}
	}
	return false
}

// trustedProxies : nombre de reverse-proxies frontaux (Caddy = 1). Configuré
// une fois au boot via SetTrustedProxies. Défaut 1 : on lit l'entrée la plus
// à droite de X-Forwarded-For (l'IP réelle vue par Caddy), pas la première
// (forgeable par le client pour usurper une IP allowlistée).
var trustedProxies = 1

// SetTrustedProxies configure le nombre de proxies de confiance pour la
// résolution d'IP de l'allowlist. Appelé une fois au câblage (main.go).
func SetTrustedProxies(n int) { trustedProxies = n }

// clientIP extrait l'IP réelle du client via netx (source unique, cf. le
// helper partagé avec ws/beacon).
func clientIP(r *http.Request) string {
	return netx.ClientIP(r, trustedProxies)
}

func itoa(n int) string {
	// Petit helper sans dépendance à strconv (déjà importé ailleurs mais
	// gardé ici pour la lisibilité du fichier).
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
