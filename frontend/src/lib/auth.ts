// Client HTTP minimal pour /api/auth/*. credentials:include partout pour
// que le cookie de session user (Domain=.ralys.ovh en prod) soit posé
// et renvoyé sur les appels cross-subdomain.

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export interface AuthUser {
  id: number;
  email: string;
}

export class AuthError extends Error {}

export async function requestMagicLink(email: string): Promise<void> {
  const res = await fetch(`${BASE}/api/auth/request`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok && res.status !== 204) {
    throw new AuthError(`request: ${res.status}`);
  }
}

export async function verifyToken(token: string): Promise<AuthUser> {
  const res = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new AuthError(`verify: ${res.status}`);
  const data = (await res.json()) as { user: AuthUser };
  return data.user;
}

export async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch(`${BASE}/api/auth/me`, {
    method: "GET",
    credentials: "include",
  });
  // Le backend renvoie 200 + user:null quand pas de session (pour ne pas
  // bruiter le DevTools avec un 401 sur le bootstrap). 401 reste défensif
  // pour les serveurs antérieurs à ce fix.
  if (res.status === 401) return null;
  if (!res.ok) throw new AuthError(`me: ${res.status}`);
  const data = (await res.json()) as { user: AuthUser | null };
  return data.user;
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}
