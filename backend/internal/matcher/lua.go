package matcher

import "github.com/redis/go-redis/v9"

// matchScript implémente le matching atomique en une seule opération Redis.
// Sans ça, ZPOPMIN + ZADD en deux commandes garantirait une race condition où
// deux clients pourraient être matchés au même peer ou se rater (CLAUDE.md
// §"Anti-patterns à proscrire").
//
// Les files sont des SORTED SETS scorés (et non plus des listes FIFO) : on
// extrait le peer au score le plus BAS (ZPOPMIN) plutôt que le plus ancien.
// Le score est `arrivée_unix - boost_qualité` (cf. matcher.MatchScore) : un
// peer plus désirable (authentifié, Premium) reçoit une arrivée effective plus
// tôt et sort en priorité, tandis que l'attente réelle finit toujours par faire
// baisser le score des autres → aucune famine.
//
//	KEYS[1] : queue cible — où chercher un peer compatible
//	KEYS[2] : queue propre — où s'inscrire si pas de peer
//	KEYS[3] : hash des niveaux CECRL (match:levels) — nettoyé au pop
//	ARGV[1] : sessionID du client courant
//	ARGV[2] : sessionID d'un peer à éviter ("" si aucun) — typiquement le
//	          dernier peer quitté via "Next", pour ne pas tomber dessus
//	          immédiatement
//	ARGV[3] : score du client courant (float) s'il faut l'inscrire
//
// Retour :
//   - sessionID du peer matché (chaîne non vide)
//   - chaîne vide si on a été ajouté à la queue
var matchScript = redis.NewScript(`
local avoid = ARGV[2]
-- On retire temporairement le peer à éviter pour ne pas le re-matcher, puis on
-- le restaure avec son score d'origine (il reste matchable par les autres).
local avoidScore = false
if avoid ~= '' then
  avoidScore = redis.call('ZSCORE', KEYS[1], avoid)
  if avoidScore then
    redis.call('ZREM', KEYS[1], avoid)
  end
end
local popped = redis.call('ZPOPMIN', KEYS[1])
if avoidScore then
  redis.call('ZADD', KEYS[1], avoidScore, avoid)
end
if popped[1] then
  redis.call('HDEL', KEYS[3], popped[1])
  return popped[1]
end
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
return ''
`)

// matchLevelScript : variante à PRÉFÉRENCE de niveau CECRL (jamais un filtre
// dur — la liquidité des files prime). Scanne les ARGV[6] premiers candidats
// de la file cible et prend le plus proche en niveau si |Δ| ≤ ARGV[5] ; sinon
// la tête de file, comme le script standard. Un candidat sans niveau connu
// compte comme Δ = ARGV[5]/2 (légèrement compatible) pour ne jamais affamer
// les anonymes. File courte → comportement identique au script standard.
//
//	KEYS   : identiques à matchScript
//	ARGV[4] : niveau CECRL du client courant (1.0..6.0)
//	ARGV[5] : Δ max toléré pour la préférence (ex. 1.0)
//	ARGV[6] : nombre de candidats scannés (ex. 10)
var matchLevelScript = redis.NewScript(`
local avoid = ARGV[2]
local avoidScore = false
if avoid ~= '' then
  avoidScore = redis.call('ZSCORE', KEYS[1], avoid)
  if avoidScore then
    redis.call('ZREM', KEYS[1], avoid)
  end
end
local myLevel = tonumber(ARGV[4])
local maxDelta = tonumber(ARGV[5])
local candidates = redis.call('ZRANGE', KEYS[1], 0, tonumber(ARGV[6]) - 1)
local chosen = false
if #candidates > 0 then
  chosen = candidates[1]
  local bestDelta = maxDelta + 1
  for _, cand in ipairs(candidates) do
    local lvl = redis.call('HGET', KEYS[3], cand)
    local delta
    if lvl then
      delta = math.abs(tonumber(lvl) - myLevel)
    else
      delta = maxDelta / 2
    end
    if delta <= maxDelta and delta < bestDelta then
      bestDelta = delta
      chosen = cand
    end
  end
  redis.call('ZREM', KEYS[1], chosen)
  redis.call('HDEL', KEYS[3], chosen)
end
if avoidScore then
  redis.call('ZADD', KEYS[1], avoidScore, avoid)
end
if chosen then
  return chosen
end
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
redis.call('HSET', KEYS[3], ARGV[1], ARGV[4])
return ''
`)
