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
//	ARGV[2] : sessionID d'un peer à éviter ("" si aucun) — typiquement le
//	          dernier peer quitté via "Next", pour ne pas tomber dessus
//	          immédiatement
//
// Retour :
//   - sessionID du peer matché (chaîne non vide)
//   - chaîne vide si on a été ajouté à la queue
var matchScript = redis.NewScript(`
local avoid = ARGV[2]
if avoid ~= '' then
  redis.call('LREM', KEYS[1], 0, avoid)
end
local peer = redis.call('LPOP', KEYS[1])
if peer then
  if avoid ~= '' then
    redis.call('RPUSH', KEYS[1], avoid)
  end
  return peer
end
if avoid ~= '' then
  redis.call('RPUSH', KEYS[1], avoid)
end
redis.call('RPUSH', KEYS[2], ARGV[1])
return ''
`)
