package profile

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"
)

type Verifier struct {
	store      *Store
	cloudinary CloudinaryConfig
	log        *slog.Logger
}

func NewVerifier(store *Store, cloudinary CloudinaryConfig, log *slog.Logger) *Verifier {
	return &Verifier{
		store:      store,
		cloudinary: cloudinary,
		log:        log,
	}
}

type faceMatcherRequest struct {
	ProfilePhotoURL string `json:"profile_photo_url"`
	LivePhotoURL    string `json:"live_photo_url"`
}

type faceMatcherResponse struct {
	Matched    bool    `json:"matched"`
	Confidence float32 `json:"confidence"`
	Error      string  `json:"error"`
}

// VerifyProfile compares the user's primary profile photo with the live captured photo
// and updates the profile's verification status accordingly.
func (v *Verifier) VerifyProfile(ctx context.Context, userID int64, livePhotoPublicID string) (bool, float32, string, error) {
	// 1. Get profile photos to retrieve position 1
	photos, err := v.store.ListPhotos(ctx, userID)
	if err != nil {
		return false, 0, "", fmt.Errorf("verify: list photos: %w", err)
	}

	var primaryPhoto *Photo
	for i := range photos {
		if photos[i].Position == 1 {
			primaryPhoto = &photos[i]
			break
		}
	}

	if primaryPhoto == nil {
		return false, 0, "Veuillez d'abord ajouter une photo de profil principale (position 1).", nil
	}

	// 2. Build secure Cloudinary URLs (limit to 800px max while preserving aspect ratio for faster download/processing)
	cloudName := v.cloudinary.CloudName
	profilePhotoURL := fmt.Sprintf("https://res.cloudinary.com/%s/image/upload/c_limit,w_800,h_800/%s", cloudName, primaryPhoto.PublicID)
	livePhotoURL := fmt.Sprintf("https://res.cloudinary.com/%s/image/upload/c_limit,w_800,h_800/%s", cloudName, livePhotoPublicID)

	// 3. Contact face-matcher microservice
	matcherURL := os.Getenv("FACE_MATCHER_URL")
	if matcherURL == "" {
		matcherURL = "http://localhost:5001"
	}
	compareURL := fmt.Sprintf("%s/compare", matcherURL)

	reqPayload := faceMatcherRequest{
		ProfilePhotoURL: profilePhotoURL,
		LivePhotoURL:    livePhotoURL,
	}

	jsonBytes, err := json.Marshal(reqPayload)
	if err != nil {
		return false, 0, "", fmt.Errorf("verify: marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", compareURL, bytes.NewBuffer(jsonBytes))
	if err != nil {
		return false, 0, "", fmt.Errorf("verify: create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 40 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		v.log.Warn("verify: face matcher is unreachable or timed out", "err", err)
		v.deleteLivePhotoAsync(livePhotoPublicID)
		return false, 0, "Le service de comparaison faciale est temporairement indisponible. Veuillez réessayer ultérieurement.", nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		v.log.Warn("verify: face matcher returned non-OK status", "status", resp.StatusCode)
		v.deleteLivePhotoAsync(livePhotoPublicID)
		return false, 0, "Le service de comparaison faciale est temporairement indisponible. Veuillez réessayer ultérieurement.", nil
	}

	var matcherResp faceMatcherResponse
	if err := json.NewDecoder(resp.Body).Decode(&matcherResp); err != nil {
		v.log.Error("verify: failed to decode face matcher response", "err", err)
		v.deleteLivePhotoAsync(livePhotoPublicID)
		return false, 0, "Le service de comparaison faciale est temporairement indisponible. Veuillez réessayer ultérieurement.", nil
	}

	// 4. Always delete the temporary live photo asynchronously
	v.deleteLivePhotoAsync(livePhotoPublicID)

	// If there's an error from face matcher (e.g. no face detected)
	if matcherResp.Error != "" {
		v.logAttempt(ctx, userID, "failed", matcherResp.Confidence)
		return false, matcherResp.Confidence, matcherResp.Error, nil
	}

	if matcherResp.Matched {
		// Save success state
		if err := v.store.MarkProfileVerified(ctx, userID, true); err != nil {
			return false, matcherResp.Confidence, "", fmt.Errorf("verify: save verification state: %w", err)
		}
		v.logAttempt(ctx, userID, "success", matcherResp.Confidence)
		return true, matcherResp.Confidence, "", nil
	}

	// Log failed match
	v.logAttempt(ctx, userID, "failed", matcherResp.Confidence)
	return false, matcherResp.Confidence, "Le selfie ne correspond pas à votre photo de profil. Veuillez réessayer sous un meilleur éclairage.", nil
}

func (v *Verifier) deleteLivePhotoAsync(publicID string) {
	go func() {
		// Create a separate background context for deletion so it doesn't get cancelled by the client request context
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		if err := v.cloudinary.Destroy(ctx, publicID); err != nil {
			v.log.Error("verify: failed to delete temporary live photo", "public_id", publicID, "err", err)
		} else {
			v.log.Info("verify: temporary live photo deleted successfully", "public_id", publicID)
		}
	}()
}

func (v *Verifier) logAttempt(ctx context.Context, userID int64, status string, confidence float32) {
	const q = `
		INSERT INTO photo_verification_attempts (user_id, status, confidence)
		VALUES ($1, $2, $3)`
	_, err := v.store.pool.Exec(ctx, q, userID, status, confidence)
	if err != nil {
		v.log.Error("verify: failed to log photo verification attempt", "user_id", userID, "status", status, "confidence", confidence, "err", err)
	}
}
