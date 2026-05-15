// Client HTTP minimal pour l'API admin du backend Go. Toutes les requêtes
// incluent les credentials (cookie `jolyne_admin`) cross-subdomain.
//
// L'URL de base est figée au build (NEXT_PUBLIC_BACKEND_HTTP_URL), comme
// pour le WS. Voir CLAUDE.md §"Back-office /admin".

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export interface ReportSummary {
  id: number;
  reported_nick: string;
  reported_fingerprint: string;
  reason: string;
  status: "open" | "resolved" | "dismissed";
  created_at: string;
}

export interface CapturedMessage {
  from: string;
  body: string;
  at: string;
}

export interface ReportDetail extends ReportSummary {
  reporter_session: string;
  reporter_fingerprint: string;
  reporter_ip_hash: string;
  reported_session: string;
  messages: CapturedMessage[];
  resolved_at?: string;
  resolved_by?: string;
  resolution_note?: string;
}

class AuthError extends Error {}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const res = await fetch(BASE + path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (res.status === 401 || res.status === 404) {
    throw new AuthError("auth required");
  }
  if (!res.ok) throw new Error(`admin: ${res.status}`);
  if (res.status === 204) return null;
  return (await res.json()) as T;
}

export async function login(email: string, password: string): Promise<boolean> {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.status === 204;
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/api/admin/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export async function fetchMe(): Promise<{ email: string } | null> {
  return request<{ email: string }>("/api/admin/me");
}

export async function listReports(
  status: "open" | "resolved" | "dismissed" | "" = "open",
): Promise<ReportSummary[]> {
  const params = status ? `?status=${status}` : "";
  const d = await request<{ reports: ReportSummary[] }>(
    `/api/admin/reports${params}`,
  );
  return d?.reports ?? [];
}

export async function getReport(id: number): Promise<ReportDetail | null> {
  return request<ReportDetail>(`/api/admin/reports/${id}`);
}

export async function resolveReport(
  id: number,
  status: "resolved" | "dismissed",
  note: string,
): Promise<void> {
  await request<void>(`/api/admin/reports/${id}/resolve`, {
    method: "POST",
    body: JSON.stringify({ status, note }),
  });
}

export { AuthError };
