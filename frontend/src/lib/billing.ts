// Client HTTP pour /api/billing/*. On ne charge PAS Stripe.js : le backend
// crée une session Checkout / Customer Portal hébergée et renvoie son URL,
// vers laquelle on redirige. Zéro clé Stripe ni dépendance côté navigateur.

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export class BillingError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function postBilling(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new BillingError(`billing: ${res.status}`, res.status);
  const data = (await res.json()) as { url: string };
  return data.url;
}

// startCheckout : ouvre le Checkout Stripe (abonnement Premium). Redirige le
// navigateur vers l'URL hébergée. Nécessite une session user (cookie).
export async function startCheckout(): Promise<void> {
  const url = await postBilling("/api/billing/checkout");
  window.location.assign(url);
}

// openPortal : ouvre le Customer Portal (gérer / annuler l'abonnement).
export async function openPortal(): Promise<void> {
  const url = await postBilling("/api/billing/portal");
  window.location.assign(url);
}
