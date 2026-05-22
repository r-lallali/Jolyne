package friends

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Pending friends Redis prefix
const PendingFriendKeyPrefix = "friend_pending_req:"

// AddPendingFriendship stores a mutual pending friendship when at least one peer is anonymous.
// u1 and u2 represent their user IDs (0 if anonymous), and fp1 and fp2 are their device fingerprints.
func AddPendingFriendship(ctx context.Context, rdb *redis.Client, u1, u2 int64, fp1, fp2 string) error {
	if rdb == nil {
		return fmt.Errorf("redis client is nil")
	}

	// u1 is anonymous, u2 is registered
	if u1 == 0 && u2 > 0 {
		key := PendingFriendKeyPrefix + fp1
		val := fmt.Sprintf("u:%d", u2)
		if err := rdb.SAdd(ctx, key, val).Err(); err != nil {
			return err
		}
		rdb.Expire(ctx, key, 7*24*time.Hour)
	}

	// u1 is registered, u2 is anonymous
	if u1 > 0 && u2 == 0 {
		key := PendingFriendKeyPrefix + fp2
		val := fmt.Sprintf("u:%d", u1)
		if err := rdb.SAdd(ctx, key, val).Err(); err != nil {
			return err
		}
		rdb.Expire(ctx, key, 7*24*time.Hour)
	}

	// Both are anonymous
	if u1 == 0 && u2 == 0 {
		key1 := PendingFriendKeyPrefix + fp1
		val1 := fmt.Sprintf("fp:%s", fp2)
		if err := rdb.SAdd(ctx, key1, val1).Err(); err != nil {
			return err
		}
		rdb.Expire(ctx, key1, 7*24*time.Hour)

		key2 := PendingFriendKeyPrefix + fp2
		val2 := fmt.Sprintf("fp:%s", fp1)
		if err := rdb.SAdd(ctx, key2, val2).Err(); err != nil {
			return err
		}
		rdb.Expire(ctx, key2, 7*24*time.Hour)
	}

	return nil
}

// ResolvePendingFriendships is called when a user registers or logs in.
// It converts fingerprint-based pending relationships into database friendships.
func ResolvePendingFriendships(ctx context.Context, rdb *redis.Client, store *Store, userID int64, fingerprint string, logger *slog.Logger) {
	if rdb == nil || store == nil || userID <= 0 || fingerprint == "" {
		return
	}

	key := PendingFriendKeyPrefix + fingerprint
	members, err := rdb.SMembers(ctx, key).Result()
	if err != nil {
		if logger != nil {
			logger.Warn("resolve pending friendships: smembers failed", "err", err, "fp", fingerprint)
		}
		return
	}

	for _, m := range members {
		if strings.HasPrefix(m, "u:") {
			// The peer was already registered!
			var peerUID int64
			if _, err := fmt.Sscanf(m, "u:%d", &peerUID); err == nil && peerUID > 0 {
				_, err = store.Add(ctx, userID, peerUID)
				if err != nil && logger != nil {
					logger.Warn("resolve pending friendships: Add friends failed", "err", err, "uid", userID, "peer", peerUID)
				} else if err == nil {
					PublishFriendsChanged(ctx, rdb, userID, peerUID)
					if logger != nil {
						logger.Info("resolve pending friendships: mutual friends created successfully!", "uid", userID, "peer", peerUID)
					}
				}
			}
			// Clean up this member since it is resolved
			rdb.SRem(ctx, key, m)
		} else if strings.HasPrefix(m, "fp:") {
			// The peer is anonymous.
			peerFP := strings.TrimPrefix(m, "fp:")
			if peerFP != "" {
				// Update the peer's pending requirements:
				// - Remove our fingerprint relation (since we are now registered and have a user ID)
				peerKey := PendingFriendKeyPrefix + peerFP
				rdb.SRem(ctx, peerKey, "fp:"+fingerprint)
				// - Add our registered UserID relation
				rdb.SAdd(ctx, peerKey, fmt.Sprintf("u:%d", userID))
				rdb.Expire(ctx, peerKey, 7*24*time.Hour)
			}
			// Clean up this member since it is updated
			rdb.SRem(ctx, key, m)
		}
	}
}
