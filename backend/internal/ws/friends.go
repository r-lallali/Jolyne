package ws

import "context"

// tryMakeFriends : appelé quand les deux côtés ont accepté le prompt 10-min.
// UPSERT idempotent — les deux peers le déclenchent en parallèle, peu
// importe l'ordre. On envoie ServerFriendMade au client local avec l'ID
// du friend pour qu'il puisse ouvrir le chat persisté.
// Renvoie true si tout s'est bien passé (sert au caller à set friendDone
// pour ne pas retenter).
func tryMakeFriends(ctx context.Context, h *Handler, conn *Conn, myUID, peerUID int64) bool {
	if h.d.Friends == nil {
		return false
	}
	f, err := h.d.Friends.Add(ctx, myUID, peerUID)
	if err != nil {
		h.d.Log.Error("friends add", "err", err)
		return false
	}
	conn.Send(ServerFrame{Type: ServerFriendMade, FriendID: f.ID})
	return true
}
