// Package netx : helpers réseau partagés. Source unique pour l'extraction de
// l'IP cliente réelle — évite la divergence historique où le WS lisait
// r.RemoteAddr (= IP du proxy) pendant que l'admin/beacon lisaient le PREMIER
// élément de X-Forwarded-For (spoofable par le client).
package netx

import (
	"net"
	"net/http"
	"strings"
)

// ClientIP renvoie l'IP cliente réelle en tenant compte de `trustedProxies`
// reverse-proxies qui AJOUTENT leur pair immédiat à X-Forwarded-For (cas de
// Caddy en frontal).
//
// Avec Caddy comme unique proxy de bord, passer trustedProxies=1 : Caddy
// ajoute l'IP réelle du client à la FIN de X-Forwarded-For, donc l'entrée la
// plus à droite est l'adresse observée par Caddy (le vrai client). Toute
// valeur injectée à gauche par le client (« X-Forwarded-For: 1.2.3.4 » pour
// usurper une IP allowlistée) est ignorée.
//
// trustedProxies <= 0 ignore complètement X-Forwarded-For et retombe sur
// RemoteAddr — à utiliser si le service est exposé en direct (pas de proxy de
// confiance), sinon n'importe qui pourrait forger l'en-tête.
func ClientIP(r *http.Request, trustedProxies int) string {
	if trustedProxies > 0 {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			// Hop de confiance le plus à droite : index len-trustedProxies.
			idx := len(parts) - trustedProxies
			if idx < 0 {
				idx = 0
			}
			if ip := strings.TrimSpace(parts[idx]); ip != "" {
				return ip
			}
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}
