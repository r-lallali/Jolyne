package ws

import (
	"context"

	"github.com/ralys/jolyne/backend/internal/analytics"
	"github.com/ralys/jolyne/backend/internal/friends"
)

// tryMakeFriendsOrPending : appelé quand les deux côtés ont accepté le prompt.
// Si les deux sont authentifiés, on crée la relation en base — avec les
// langues natives des deux côtés (le matching est réciproque : la langue
// native du peer = mon `wants`). Sinon, on stocke une relation pendante
// dans Redis sous les fingerprints respectifs.
func tryMakeFriendsOrPending(ctx context.Context, h *Handler, conn *Conn, myUID, peerUID int64, myFP, peerFP, myLang, peerLang string) bool {
	if h.d.Friends == nil {
		return false
	}

	if myUID > 0 && peerUID > 0 {
		f, err := h.d.Friends.Add(ctx, myUID, peerUID, myLang, peerLang)
		if err != nil {
			h.d.Log.Error("friends add failed", "err", err)
			return false
		}
		// Un event par participant (chaque côté déroule son propre runChat),
		// même convention que match_found.
		h.d.Tracker.Emit(analytics.Event{
			Name:   analytics.EventFriendAdded,
			UserID: myUID,
			AnonID: analytics.HashID(myFP),
			Props:  map[string]any{"pending": false},
		})
		conn.Send(ServerFrame{Type: ServerFriendMade, FriendID: f.ID})
		return true
	}

	// Au moins un anonyme : on met de côté dans Redis
	err := friends.AddPendingFriendship(ctx, h.d.RDB, myUID, peerUID, myFP, peerFP)
	if err != nil {
		h.d.Log.Error("friends add pending failed", "err", err)
		return false
	}

	h.d.Tracker.Emit(analytics.Event{
		Name:   analytics.EventFriendAdded,
		UserID: myUID,
		AnonID: analytics.HashID(myFP),
		Props:  map[string]any{"pending": true},
	})
	// Signale qu'une relation a été validée mais est en attente (-1)
	conn.Send(ServerFrame{Type: ServerFriendMade, FriendID: -1})
	return true
}
