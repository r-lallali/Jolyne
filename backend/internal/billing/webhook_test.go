package billing

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

const testWebhookSecret = "whsec_test_secret"

// --- fakes ---

type subCall struct {
	customerID string
	status     string
	periodEnd  *time.Time
}

type fakeSubs struct {
	subCalls []subCall
}

func (f *fakeSubs) SetCustomerID(context.Context, int64, string) error { return nil }
func (f *fakeSubs) SetSubscription(_ context.Context, customerID, status string, periodEnd *time.Time) error {
	f.subCalls = append(f.subCalls, subCall{customerID, status, periodEnd})
	return nil
}

type fakeEvents struct {
	seen map[string]bool
}

func (f *fakeEvents) AlreadyProcessed(_ context.Context, id string) (bool, error) {
	return f.seen[id], nil
}
func (f *fakeEvents) MarkProcessed(_ context.Context, id string) error {
	if f.seen == nil {
		f.seen = map[string]bool{}
	}
	f.seen[id] = true
	return nil
}

// --- helpers ---

// signPayload reproduit le schéma de signature Stripe : v1 = HMAC-SHA256 de
// "{timestamp}.{payload}" avec le webhook secret.
func signPayload(secret string, payload []byte, ts time.Time) string {
	mac := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(mac, "%d.", ts.Unix())
	mac.Write(payload)
	return fmt.Sprintf("t=%d,v1=%s", ts.Unix(), hex.EncodeToString(mac.Sum(nil)))
}

func subscriptionEvent(id, typ, customerID, status string, periodEnd int64) []byte {
	return []byte(fmt.Sprintf(
		`{"id":%q,"type":%q,"data":{"object":{"id":"sub_1","customer":%q,"status":%q,"items":{"data":[{"current_period_end":%d}]}}}}`,
		id, typ, customerID, status, periodEnd))
}

func newHandlers(subs *fakeSubs, events *fakeEvents) *Handlers {
	return &Handlers{
		Stripe: New(Config{WebhookSecret: testWebhookSecret}),
		Users:  subs,
		Events: events,
	}
}

func postWebhook(h *Handlers, payload []byte, sig string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/billing/webhook", bytes.NewReader(payload))
	req.Header.Set("Stripe-Signature", sig)
	rec := httptest.NewRecorder()
	h.HandleWebhook(rec, req)
	return rec
}

// --- tests ---

func TestWebhook_SubscriptionActivatesUser(t *testing.T) {
	subs, events := &fakeSubs{}, &fakeEvents{}
	h := newHandlers(subs, events)
	end := time.Now().Add(720 * time.Hour).Unix()
	payload := subscriptionEvent("evt_1", "customer.subscription.created", "cus_123", "active", end)

	rec := postWebhook(h, payload, signPayload(testWebhookSecret, payload, time.Now()))

	if rec.Code != http.StatusOK {
		t.Fatalf("attendu 200, got %d", rec.Code)
	}
	if len(subs.subCalls) != 1 {
		t.Fatalf("attendu 1 SetSubscription, got %d", len(subs.subCalls))
	}
	c := subs.subCalls[0]
	if c.customerID != "cus_123" || c.status != "active" {
		t.Fatalf("args inattendus: %+v", c)
	}
	if c.periodEnd == nil || c.periodEnd.Unix() != end {
		t.Fatalf("periodEnd inattendu: %v", c.periodEnd)
	}
	if !events.seen["evt_1"] {
		t.Fatal("event non marqué traité")
	}
}

func TestWebhook_DeletedDowngrades(t *testing.T) {
	subs, events := &fakeSubs{}, &fakeEvents{}
	h := newHandlers(subs, events)
	payload := subscriptionEvent("evt_2", "customer.subscription.deleted", "cus_9", "canceled", 0)

	rec := postWebhook(h, payload, signPayload(testWebhookSecret, payload, time.Now()))

	if rec.Code != http.StatusOK {
		t.Fatalf("attendu 200, got %d", rec.Code)
	}
	if len(subs.subCalls) != 1 || subs.subCalls[0].status != "canceled" {
		t.Fatalf("attendu un downgrade canceled, got %+v", subs.subCalls)
	}
}

func TestWebhook_Idempotent(t *testing.T) {
	subs, events := &fakeSubs{}, &fakeEvents{}
	h := newHandlers(subs, events)
	end := time.Now().Add(720 * time.Hour).Unix()
	payload := subscriptionEvent("evt_3", "customer.subscription.updated", "cus_5", "active", end)
	sig := signPayload(testWebhookSecret, payload, time.Now())

	postWebhook(h, payload, sig)
	rec := postWebhook(h, payload, sig) // rejeu du même event

	if rec.Code != http.StatusOK {
		t.Fatalf("rejeu: attendu 200, got %d", rec.Code)
	}
	if len(subs.subCalls) != 1 {
		t.Fatalf("rejeu ne doit pas ré-appliquer : got %d effets", len(subs.subCalls))
	}
}

func TestWebhook_RejectsBadSignature(t *testing.T) {
	subs, events := &fakeSubs{}, &fakeEvents{}
	h := newHandlers(subs, events)
	payload := subscriptionEvent("evt_4", "customer.subscription.created", "cus_x", "active", 1)

	rec := postWebhook(h, payload, signPayload("whsec_WRONG", payload, time.Now()))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("signature invalide: attendu 400, got %d", rec.Code)
	}
	if len(subs.subCalls) != 0 {
		t.Fatal("aucun effet ne doit être appliqué sur signature invalide")
	}
}
