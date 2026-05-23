package friends

import (
	"context"
	"strconv"

	"github.com/redis/go-redis/v9"
)

// Channel pub/sub par user — sert à signaler à l'inbox WS qu'il faut
// re-souscrire à la liste d'amitiés (ami ajouté ou retiré). Le payload
// est volontairement minimal — l'inbox côté serveur ne refait pas la liste
// pour le client, il pousse juste un frame qui déclenche un reconnect
// côté front. Le front réouvre alors le WS, ce qui re-snapshot la liste.
const UserInboxChanPrefix = "user_inbox:"

const (
	UserInboxKindFriendsChanged = "friends_changed"
)

func UserInboxChannel(userID int64) string {
	return UserInboxChanPrefix + strconv.FormatInt(userID, 10)
}

// PublishFriendsChanged : best-effort, swallow erreurs (notification, pas
// donnée critique). Publie pour les deux users concernés par l'ajout /
// retrait d'amitié.
func PublishFriendsChanged(ctx context.Context, rdb *redis.Client, userIDs ...int64) {
	if rdb == nil {
		return
	}
	for _, uid := range userIDs {
		if uid <= 0 {
			continue
		}
		_ = rdb.Publish(ctx, UserInboxChannel(uid), UserInboxKindFriendsChanged).Err()
	}
}

// PublishStreakRestored : signale aux deux users qu'un streak vient d'être
// restauré sur cette amitié. Payload "restored:{friend_id}:{n}" parsé par
// l'inbox handler côté ws.
func PublishStreakRestored(ctx context.Context, rdb *redis.Client, userIDs []int64, friendID int64, newStreak int) {
	if rdb == nil {
		return
	}
	payload := "restored:" + strconv.FormatInt(friendID, 10) + ":" + strconv.Itoa(newStreak)
	for _, uid := range userIDs {
		if uid <= 0 {
			continue
		}
		_ = rdb.Publish(ctx, UserInboxChannel(uid), payload).Err()
	}
}
