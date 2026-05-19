// Client HTTP minimal pour /api/auth/*. credentials:include partout pour
// que le cookie de session user (Domain=.ralys.ovh en prod) soit posé
// et renvoyé sur les appels cross-subdomain.

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export interface AuthUser {
  id: number;
  email: string;
  email_verified: boolean;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function postAuth<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new AuthError(`auth: ${res.status}`, res.status);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function signup(email: string, password: string): Promise<AuthUser> {
  const data = await postAuth<{ user: AuthUser }>("/api/auth/signup", {
    email,
    password,
  });
  return data.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const data = await postAuth<{ user: AuthUser }>("/api/auth/login", {
    email,
    password,
  });
  return data.user;
}

export async function verifyEmail(token: string): Promise<AuthUser> {
  const data = await postAuth<{ user: AuthUser }>("/api/auth/verify-email", {
    token,
  });
  return data.user;
}

export async function forgotPassword(email: string): Promise<void> {
  await postAuth<void>("/api/auth/forgot", { email });
}

export async function resetPassword(
  token: string,
  password: string,
): Promise<AuthUser> {
  const data = await postAuth<{ user: AuthUser }>("/api/auth/reset", {
    token,
    password,
  });
  return data.user;
}

export async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch(`${BASE}/api/auth/me`, {
    method: "GET",
    credentials: "include",
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new AuthError(`me: ${res.status}`, res.status);
  const data = (await res.json()) as { user: AuthUser | null };
  return data.user;
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}
