package billing

import (
	"testing"
	"time"

	"github.com/stripe/stripe-go/v82"
)

func TestSubscriptionPeriodEnd(t *testing.T) {
	// Depuis l'API Stripe récente, current_period_end est porté par les items.
	unix := int64(1893456000) // 2030-01-01 UTC
	sub := &stripe.Subscription{
		Items: &stripe.SubscriptionItemList{
			Data: []*stripe.SubscriptionItem{{CurrentPeriodEnd: unix}},
		},
	}
	got := subscriptionPeriodEnd(sub)
	if got == nil {
		t.Fatal("attendu une date, got nil")
	}
	if !got.Equal(time.Unix(unix, 0).UTC()) {
		t.Fatalf("date inattendue: %v", got)
	}
}

func TestSubscriptionPeriodEnd_NoItems(t *testing.T) {
	if subscriptionPeriodEnd(&stripe.Subscription{}) != nil {
		t.Fatal("sans items, on attend nil")
	}
	empty := &stripe.Subscription{Items: &stripe.SubscriptionItemList{}}
	if subscriptionPeriodEnd(empty) != nil {
		t.Fatal("items vides → nil")
	}
}
