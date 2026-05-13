package matcher

import "github.com/redis/go-redis/v9"

// matchScript implémente le matching atomique en une seule opération Redis.
// Sans ça, LPOP + LPUSH en deux commandes garantirait une race condition où
// deux clients pourraient être matchés au même peer ou se rater (CLAUDE.md
// §"Anti-patterns à proscrire").
//
//	KEYS[1] : queue cible — où chercher un peer compatible
//	KEYS[2] : queue propre — où s'inscrire si pas de peer
//	ARGV[1] : sessionID du client courant
//
// Retour :
//   - sessionID du peer matché (chaîne non vide)
//   - chaîne vide si on a été ajouté à la queue
var matchScript = redis.NewScript(`
local peer = redis.call('LPOP', KEYS[1])
if peer then
  return peer
end
redis.call('RPUSH', KEYS[2], ARGV[1])
return ''
`)
