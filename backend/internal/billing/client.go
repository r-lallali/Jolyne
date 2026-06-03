// Package billing : abonnement Premium via Stripe (Checkout + Customer
// Portal + webhooks). Feature optionnelle — si les clés Stripe manquent, le
// package n'est pas instancié et les routes /api/billing/* renvoient 503.
package billing

import (
	"fmt"
	"time"

	"github.com/stripe/stripe-go/v82"
	billingportalsession "github.com/stripe/stripe-go/v82/billingportal/session"
	checkoutsession "github.com/stripe/stripe-go/v82/checkout/session"
	"github.com/stripe/stripe-go/v82/customer"
	"github.com/stripe/stripe-go/v82/webhook"
)

// Config regroupe les paramètres Stripe nécessaires.
type Config struct {
	SecretKey     string // sk_...
	WebhookSecret string // whsec_... (vérification de signature)
	PriceID       string // price_... de l'abonnement Premium
	SuccessURL    string // redirection Checkout en cas de succès
	CancelURL     string // redirection Checkout en cas d'annulation
}

// Client encapsule les appels Stripe. La clé secrète est posée en global
// (stripe.Key) — un seul compte Stripe pour le process.
type Client struct {
	priceID       string
	webhookSecret string
	successURL    string
	cancelURL     string
}

func New(cfg Config) *Client {
	stripe.Key = cfg.SecretKey
	return &Client{
		priceID:       cfg.PriceID,
		webhookSecret: cfg.WebhookSecret,
		successURL:    cfg.SuccessURL,
		cancelURL:     cfg.CancelURL,
	}
}

// CreateCustomer crée un customer Stripe pour l'email du user et renvoie son ID.
func (c *Client) CreateCustomer(email string) (string, error) {
	cust, err := customer.New(&stripe.CustomerParams{Email: stripe.String(email)})
	if err != nil {
		return "", fmt.Errorf("billing: create customer: %w", err)
	}
	return cust.ID, nil
}

// CreateCheckoutSession ouvre une session Checkout en mode abonnement pour le
// price Premium et renvoie l'URL hébergée vers laquelle rediriger le client.
func (c *Client) CreateCheckoutSession(customerID string) (string, error) {
	params := &stripe.CheckoutSessionParams{
		Customer: stripe.String(customerID),
		Mode:     stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{Price: stripe.String(c.priceID), Quantity: stripe.Int64(1)},
		},
		SuccessURL: stripe.String(c.successURL),
		CancelURL:  stripe.String(c.cancelURL),
	}
	s, err := checkoutsession.New(params)
	if err != nil {
		return "", fmt.Errorf("billing: checkout session: %w", err)
	}
	return s.URL, nil
}

// CreatePortalSession ouvre une session Customer Portal (gérer / annuler
// l'abonnement) et renvoie l'URL hébergée.
func (c *Client) CreatePortalSession(customerID, returnURL string) (string, error) {
	s, err := billingportalsession.New(&stripe.BillingPortalSessionParams{
		Customer:  stripe.String(customerID),
		ReturnURL: stripe.String(returnURL),
	})
	if err != nil {
		return "", fmt.Errorf("billing: portal session: %w", err)
	}
	return s.URL, nil
}

// VerifyWebhook valide la signature Stripe et renvoie l'event décodé.
//
// IgnoreAPIVersionMismatch : sans ça, ConstructEvent rejette tout event dont
// la version d'API du compte Stripe diffère de celle figée dans le SDK — un
// piège classique qui ferait échouer 100% des webhooks au moindre décalage de
// version. Les champs qu'on lit (status, customer, items.current_period_end)
// sont stables, donc on désactive ce check.
func (c *Client) VerifyWebhook(payload []byte, sigHeader string) (stripe.Event, error) {
	return webhook.ConstructEventWithOptions(payload, sigHeader, c.webhookSecret,
		webhook.ConstructEventOptions{IgnoreAPIVersionMismatch: true})
}

// subscriptionPeriodEnd lit la fin de période payée. Depuis l'API Stripe
// récente, current_period_end vit au niveau des items, pas de la subscription.
func subscriptionPeriodEnd(sub *stripe.Subscription) *time.Time {
	if sub.Items == nil || len(sub.Items.Data) == 0 {
		return nil
	}
	end := sub.Items.Data[0].CurrentPeriodEnd
	if end == 0 {
		return nil
	}
	t := time.Unix(end, 0).UTC()
	return &t
}
