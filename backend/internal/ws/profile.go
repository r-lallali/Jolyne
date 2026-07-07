package ws

import (
	"context"
	"time"
)

// sendPeerProfile : récupère display_name / photo principale / prompts du
// peer authentifié et pousse une frame ServerPeerProfile au client local.
// Best-effort : silence sur erreur (chat anonyme reste fonctionnel).
func (h *Handler) sendPeerProfile(ctx context.Context, conn *Conn, peerUID int64) {
	fetchCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	p, err := h.d.Profiles.Get(fetchCtx, peerUID)
	if err != nil {
		return
	}
	photos, _ := h.d.Profiles.ListPhotos(fetchCtx, peerUID)
	photoID := ""
	for _, ph := range photos {
		if ph.Position == 1 {
			photoID = ph.PublicID
			break
		}
	}
	if photoID == "" && len(photos) > 0 {
		photoID = photos[0].PublicID
	}
	prompts := []ServerPrompt{
		{Prompt: p.Prompt1, Answer: p.Answer1},
		{Prompt: p.Prompt2, Answer: p.Answer2},
		{Prompt: p.Prompt3, Answer: p.Answer3},
	}
	// Niveau CECRL estimé du peer — badge « ≈ B1 » côté client. Best-effort.
	var cefr float64
	if h.d.ResolveCEFR != nil {
		cefr = h.d.ResolveCEFR(fetchCtx, peerUID)
	}
	conn.Send(ServerFrame{
		Type:         ServerPeerProfile,
		PeerPhotoID:  photoID,
		PeerPrompts:  prompts,
		PeerVerified: p.IsVerified,
		PeerCEFR:     cefr,
	})
}
