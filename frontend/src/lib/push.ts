// Web Push : abonnement au PushManager + envoi du subscription au backend.
// Le SW est enregistré une fois (idempotent) ; on s'abonne uniquement si
// la permission est accordée. Pas de prompt automatique — un caller doit
// explicitement déclencher l'enable depuis une interaction user (sinon
// les browsers ignorent la demande).

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export async function fetchVAPIDPublicKey(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/notifications/vapid-public-key`);
    if (!res.ok) return null;
    const data = (await res.json()) as { public_key: string };
    return data.public_key || null;
  } catch {
    return null;
  }
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined") return null;
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  const reg = await registerServiceWorker();
  if (!reg) return null;
  return (await reg.pushManager.getSubscription()) ?? null;
}

// Subscribe au PushManager + POST vers le backend. À appeler uniquement
// après que l'utilisateur a accordé la permission (Notification.permission
// === 'granted'). Renvoie null si quoi que ce soit échoue.
export async function subscribePush(): Promise<PushSubscription | null> {
  const reg = await registerServiceWorker();
  if (!reg) return null;
  const pubKey = await fetchVAPIDPublicKey();
  if (!pubKey) return null;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pubKey) as BufferSource,
      });
    } catch {
      return null;
    }
  }
  try {
    const json = sub.toJSON();
    await fetch(`${API_BASE}/api/notifications/subscribe`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      }),
    });
  } catch {
    // si la sauvegarde côté serveur échoue, on désabonne pour éviter
    // un état zombie (sub côté navigateur, rien côté DB).
    try {
      await sub.unsubscribe();
    } catch {
      // ignore
    }
    return null;
  }
  return sub;
}

export async function unsubscribePush(): Promise<void> {
  const sub = await getExistingSubscription();
  if (!sub) return;
  try {
    await fetch(`${API_BASE}/api/notifications/subscribe`, {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch {
    // ignore
  }
  try {
    await sub.unsubscribe();
  } catch {
    // ignore
  }
}

// Convertit la VAPID public key (base64url) en Uint8Array attendu par
// PushManager.subscribe(applicationServerKey).
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
