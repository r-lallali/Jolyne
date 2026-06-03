package billing

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/stripe/stripe-go/v82"

	"github.com/ralys/jolyne/backend/internal/users"
)

// Subscriptions : opérations user nécessaires au billing (implémenté par
// users.Store). SetCustomerID lie le customer Stripe au user au 1er checkout ;
// SetSubscription miroite l'état d'abonnement reçu par le webhook.
type Subscriptions interface {
	SetCustomerID(ctx context.Context, userID int64, customerID string) error
	SetSubscription(ctx context.Context, customerID, status string, periodEnd *time.Time) error
}

// EventLog : déduplication idempotente des webhooks Stripe (table stripe_events).
type EventLog interface {
	AlreadyProcessed(ctx context.Context, eventID string) (bool, error)
	MarkProcessed(ctx context.Context, eventID string) error
}

// Handlers expose /api/billing/{checkout,portal,webhook}. checkout et portal
// sont montés derrière users.RequireAuth (le user est dans le ctx) ; webhook
// est public mais authentifié par la signature Stripe.
type Handlers struct {
	Stripe    *Client
	Users     Subscriptions
	Events    EventLog
	ReturnURL string // retour du Customer Portal (ex: .../account)
	Log       *slog.Logger
}

func (h *Handlers) log() *slog.Logger {
	if h.Log != nil {
		return h.Log
	}
	return slog.Default()
}

// HandleCheckout : POST /api/billing/checkout (auth) → {url} de Checkout.
func (h *Handlers) HandleCheckout(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	customerID, err := h.ensureCustomer(r.Context(), user)
	if err != nil {
		h.log().Error("billing: ensure customer", "err", err)
		http.Error(w, "billing unavailable", http.StatusBadGateway)
		return
	}
	url, err := h.Stripe.CreateCheckoutSession(customerID)
	if err != nil {
		h.log().Error("billing: checkout", "err", err)
		http.Error(w, "billing unavailable", http.StatusBadGateway)
		return
	}
	writeJSON(w, map[string]string{"url": url})
}

// HandlePortal : POST /api/billing/portal (auth) → {url} du Customer Portal.
func (h *Handlers) HandlePortal(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	if user.StripeCustomerID == nil || *user.StripeCustomerID == "" {
		http.Error(w, "no subscription", http.StatusBadRequest)
		return
	}
	url, err := h.Stripe.CreatePortalSession(*user.StripeCustomerID, h.ReturnURL)
	if err != nil {
		h.log().Error("billing: portal", "err", err)
		http.Error(w, "billing unavailable", http.StatusBadGateway)
		return
	}
	writeJSON(w, map[string]string{"url": url})
}

// HandleWebhook : POST /api/billing/webhook (public, signature Stripe). Lit le
// corps brut, vérifie la signature, puis miroite l'état d'abonnement.
//
// Ordre choisi : on applique l'effet AVANT de marquer l'event traité. Ainsi un
// échec transitoire laisse l'event non marqué → Stripe rejoue → on réapplique
// (SetSubscription est idempotent). On évite le piège « event marqué mais effet
// non appliqué » = abonné qui paye sans accès (PLAN.md §7).
func (h *Handlers) HandleWebhook(w http.ResponseWriter, r *http.Request) {
	payload, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64*1024))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	event, err := h.Stripe.VerifyWebhook(payload, r.Header.Get("Stripe-Signature"))
	if err != nil {
		http.Error(w, "invalid signature", http.StatusBadRequest)
		return
	}

	seen, err := h.Events.AlreadyProcessed(r.Context(), event.ID)
	if err != nil {
		h.log().Error("billing: event lookup", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	if seen {
		w.WriteHeader(http.StatusOK)
		return
	}

	switch event.Type {
	case stripe.EventTypeCustomerSubscriptionCreated,
		stripe.EventTypeCustomerSubscriptionUpdated,
		stripe.EventTypeCustomerSubscriptionDeleted:
		var sub stripe.Subscription
		if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
			http.Error(w, "bad payload", http.StatusBadRequest)
			return
		}
		customerID := ""
		if sub.Customer != nil {
			customerID = sub.Customer.ID
		}
		if customerID == "" {
			break // event sans customer exploitable — on l'ignore proprement
		}
		if err := h.Users.SetSubscription(
			r.Context(), customerID, string(sub.Status), subscriptionPeriodEnd(&sub),
		); err != nil {
			h.log().Error("billing: set subscription", "err", err)
			http.Error(w, "internal", http.StatusInternalServerError)
			return
		}
	}

	if err := h.Events.MarkProcessed(r.Context(), event.ID); err != nil {
		// L'effet est déjà appliqué ; on log sans faire échouer (un rejeu
		// réappliquera le même état idempotent).
		h.log().Warn("billing: mark event", "err", err, "event", event.ID)
	}
	w.WriteHeader(http.StatusOK)
}

func (h *Handlers) ensureCustomer(ctx context.Context, user users.User) (string, error) {
	if user.StripeCustomerID != nil && *user.StripeCustomerID != "" {
		return *user.StripeCustomerID, nil
	}
	customerID, err := h.Stripe.CreateCustomer(user.Email)
	if err != nil {
		return "", err
	}
	if err := h.Users.SetCustomerID(ctx, user.ID, customerID); err != nil {
		return "", err
	}
	return customerID, nil
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
