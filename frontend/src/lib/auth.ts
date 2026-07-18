import { getFingerprint } from "./fingerprint";

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export interface AuthUser {
  id: number;
  email: string;
  email_verified: boolean;
  // Abonnement Premium (renvoyé par /api/auth/me). is_premium = droit effectif.
  plan: "free" | "premium";
  is_premium: boolean;
  premium_until?: string; // ISO 8601, présent si un abonnement existe
  // Niveau CECRL estimé par l'IA (1.0..6.0). Absent tant qu'aucune
  // conversation n'a été analysée. Converti en libellé via cefrLabel().
  cefr_score?: number;
}

// cefrLabel : score continu (1.0..6.0) → libellé CECRL le plus proche.
// null si le score est absent/invalide (badge masqué).
export function cefrLabel(score?: number): string | null {
  if (!score || score < 0.5) return null;
  const labels = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const idx = Math.min(6, Math.max(1, Math.round(score)));
  return labels[idx - 1] ?? null;
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

export async function signup(
  email: string,
  password: string,
  displayName?: string,
): Promise<AuthUser> {
  const fp = await getFingerprint().catch(() => "");
  const data = await postAuth<{ user: AuthUser }>("/api/auth/signup", {
    email,
    password,
    display_name: displayName ?? "",
    fingerprint: fp,
  });
  return data.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const fp = await getFingerprint().catch(() => "");
  const data = await postAuth<{ user: AuthUser }>("/api/auth/login", {
    email,
    password,
    fingerprint: fp,
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

// Social login (Google / Apple), flow authorization code côté serveur :
// on redirige simplement le navigateur vers le backend, qui renvoie vers
// l'écran de consentement du provider puis pose le cookie de session au
// callback et revient sur le front (`/?oauth=ok|error`).
export type OAuthProvider = "google" | "apple";

export async function fetchOAuthProviders(): Promise<OAuthProvider[]> {
  try {
    const res = await fetch(`${BASE}/api/auth/oauth/providers`);
    if (!res.ok) return [];
    const data = (await res.json()) as { providers: OAuthProvider[] };
    return data.providers ?? [];
  } catch {
    return [];
  }
}

export async function startOAuth(provider: OAuthProvider): Promise<void> {
  const fp = await getFingerprint().catch(() => "");
  const url = new URL(`${BASE}/api/auth/oauth/${provider}/start`, window.location.href);
  if (fp) url.searchParams.set("fp", fp);
  window.location.href = url.toString();
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
