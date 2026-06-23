// Client HTTP pour les dashboards analytics du back-office (/api/admin/stats/*).
// Même convention que lib/admin.ts : cookie `jolyne_admin` cross-subdomain,
// AuthError sur 401/404 (le front redirige alors vers /admin/login).

import { AuthError } from "@/lib/admin";

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

async function req<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const res = await fetch(BASE + path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (res.status === 401 || res.status === 404) throw new AuthError("auth required");
  if (!res.ok) throw new Error(`stats: ${res.status}`);
  if (res.status === 204) return null;
  return (await res.json()) as T;
}

// URL absolue d'un endpoint (pour les téléchargements CSV / export RGPD ouverts
// dans un nouvel onglet — le cookie part car cross-subdomain en credentials).
export function statsURL(path: string): string {
  return BASE + path;
}

// ---- Types (miroir des structs Go) ----

export interface QueueDepth {
  pair: string;
  count: number;
}

export interface Overview {
  total_users: number;
  new_users_24h: number;
  new_users_7d: number;
  dau: number;
  wau: number;
  mau: number;
  premium_users: number;
  conversations_24h: number;
  human_matches_24h: number;
  bot_matches_24h: number;
  online_now: number;
  searching: number;
  queue_depth: QueueDepth[];
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}

export interface RetentionRow {
  cohort: string;
  size: number;
  values: Record<string, number>;
  rates: Record<string, number>;
}

export interface TimePoint {
  bucket: string;
  value: number;
}

export interface LangPair {
  pair: string;
  count: number;
}

export interface Engagement {
  matches: number;
  bot_matches: number;
  messages: number;
  conversations_ended: number;
  avg_duration_sec: number;
  bot_fallback_pct: number;
  lang_pairs: LangPair[];
}

export interface Revenue {
  activations: number;
  cancellations: number;
  active_premium: number;
  signups_in_range: number;
  conversion_pct: number;
  mrr_cents: number;
}

export interface ServerSnapshot {
  goroutines: number;
  heap_alloc_mb: number;
  num_gc: number;
  uptime_sec: number;
  online_now: number;
  searching: number;
  queue_depth: QueueDepth[];
  health: Record<string, string>;
  db_pool: Record<string, number>;
}

export interface UserRow {
  id: number;
  email: string;
  plan: string;
  verified: boolean;
  created_at: string;
  last_seen_at?: string;
}

export interface UserDetail extends UserRow {
  subscription_status?: string;
  current_period_end?: string;
  has_stripe_customer: boolean;
  total_events: number;
  conversations: number;
  messages: number;
  first_seen?: string;
  last_event?: string;
  banned: boolean;
}

export interface AuditEntry {
  actor: string;
  action: string;
  target_type: string;
  target_value: string;
  reason?: string;
  created_at: string;
}

export type TimeSeriesMetric =
  | "page_views"
  | "signups"
  | "active_users"
  | "matches"
  | "messages"
  | "premium";

// ---- Calls ----

const range = (from?: string, to?: string) => {
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const fetchOverview = () =>
  req<Overview>("/api/admin/stats/overview");

export const fetchFunnel = (from?: string, to?: string) =>
  req<{ stages: FunnelStage[] }>(`/api/admin/stats/funnel${range(from, to)}`).then(
    (d) => d?.stages ?? [],
  );

export const fetchRetention = (cohort: "weekly" | "daily" = "weekly") =>
  req<{ unit: string; cohorts: RetentionRow[] }>(
    `/api/admin/stats/retention?cohort=${cohort}`,
  );

export const fetchTimeSeries = (
  metric: TimeSeriesMetric,
  interval: "hour" | "day" | "week" = "day",
  from?: string,
  to?: string,
) =>
  req<{ points: TimePoint[] }>(
    `/api/admin/stats/timeseries?metric=${metric}&interval=${interval}${range(from, to).replace("?", "&")}`,
  ).then((d) => d?.points ?? []);

export const fetchEngagement = (from?: string, to?: string) =>
  req<Engagement>(`/api/admin/stats/engagement${range(from, to)}`);

export const fetchRevenue = (from?: string, to?: string) =>
  req<Revenue>(`/api/admin/stats/revenue${range(from, to)}`);

export const fetchServer = () =>
  req<ServerSnapshot>("/api/admin/stats/server");

export const searchUsers = (q = "", limit = 50, offset = 0) =>
  req<{ users: UserRow[] }>(
    `/api/admin/stats/users?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`,
  ).then((d) => d?.users ?? []);

export const fetchUser = (id: number) =>
  req<UserDetail>(`/api/admin/stats/users/${id}`);

export const setUserPremium = (id: number, grant: boolean) =>
  req<void>(`/api/admin/stats/users/${id}/premium`, {
    method: "POST",
    body: JSON.stringify({ grant }),
  });

export const banUser = (id: number, duration: string, reason: string) =>
  req<void>(`/api/admin/stats/users/${id}/ban`, {
    method: "POST",
    body: JSON.stringify({ duration, reason }),
  });

export const deleteUser = (id: number) =>
  req<void>(`/api/admin/stats/users/${id}`, { method: "DELETE" });

export const fetchAudit = (limit = 100, offset = 0) =>
  req<{ entries: AuditEntry[] }>(
    `/api/admin/stats/audit?limit=${limit}&offset=${offset}`,
  ).then((d) => d?.entries ?? []);

export { AuthError };
