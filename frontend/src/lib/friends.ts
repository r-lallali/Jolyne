// Client HTTP /api/friends/*. credentials:include partout (cookie session
// user requis pour toutes ces routes).
//
// Tous les champs texte servis par le backend sortent HTML-escaped (cf.
// `html.EscapeString` côté Go — défense en profondeur règle d'or #2). On
// les décode AU NIVEAU DU CLIENT API pour que les composants d'affichage
// n'aient pas à connaître ce détail.

import { decodeEntities } from "@/lib/sanitize";

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export interface FriendSummary {
  id: number;
  peer_id: number;
  peer_name: string;
  peer_photo_id?: string;
  // Langue native du peer figée à la création de l'amitié (absente si
  // inconnue — flux pending). Indice de langue source pour la traduction.
  peer_lang?: string;
  peer_removed_me: boolean;
  unread_count: number;
  last_message_body: string;
  last_message_sender_id: number;
  last_message_deleted: boolean;
  created_at: string;
  last_message_at: string;
  peer_verified?: boolean;
  streak: number;
  streak_at_risk: boolean;
  lost_streak?: number;
  lost_at?: string;
  restores_remaining_this_month?: number;
}

export interface FriendMessage {
  id: number;
  sender_id: number;
  body: string;
  sent_at: string;
  edited_at?: string;
  deleted_at?: string;
  // Kind = absent / "user" pour un message tapé par un user, ou un
  // identifiant système ("system_streak_lost", …). Les messages système
  // ne sont pas éditables / supprimables côté UI.
  kind?: string;
  // Payload : JSON brut associé à un kind système (ex. {"days":12}).
  payload?: string;
}

// Étendu côté serveur dans /api/friends — voir handlers.go friendDTO.
export interface FriendStreakFields {
  streak: number;
  streak_at_risk: boolean;
  lost_streak?: number;
  lost_at?: string;
}

export interface FriendProfile {
  peer_id: number;
  // Langue native du peer (cf. FriendSummary.peer_lang).
  peer_lang?: string;
  display_name: string;
  bio: string;
  birthdate: string | null;
  photos: { position: number; public_id: string }[];
  prompts: { prompt: string; answer: string }[];
  peer_removed_me: boolean;
  peer_verified?: boolean;
  streak: number;
  streak_at_risk: boolean;
  lost_streak?: number;
  lost_at?: string;
  restores_remaining_this_month?: number;
}

export class FriendsError extends Error {
  status: number;
  constructor(msg: string, status: number) {
    super(msg);
    this.status = status;
  }
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new FriendsError(`friends: ${res.status}`, res.status);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function listFriends(): Promise<FriendSummary[]> {
  const d = await api<{ friends: FriendSummary[] }>("GET", "/api/friends");
  return (d.friends ?? []).map((f) => ({
    ...f,
    peer_name: decodeEntities(f.peer_name),
    last_message_body: decodeEntities(f.last_message_body ?? ""),
  }));
}

export interface FriendMessagesResponse {
  messages: FriendMessage[];
  peer_removed_me: boolean;
}

export async function getFriendMessages(
  id: number,
): Promise<FriendMessagesResponse> {
  const d = await api<FriendMessagesResponse>(
    "GET",
    `/api/friends/${id}/messages`,
  );
  return {
    messages: (d.messages ?? []).map(decodeFriendMessage),
    peer_removed_me: !!d.peer_removed_me,
  };
}

export async function postFriendMessage(id: number, body: string): Promise<FriendMessage> {
  const m = await api<FriendMessage>("POST", `/api/friends/${id}/messages`, { body });
  return decodeFriendMessage(m);
}

export async function getFriendProfile(id: number): Promise<FriendProfile> {
  const p = await api<FriendProfile>("GET", `/api/friends/${id}/profile`);
  return {
    ...p,
    display_name: decodeEntities(p.display_name),
    bio: decodeEntities(p.bio),
    prompts: (p.prompts ?? []).map((q) => ({
      prompt: q.prompt,
      answer: decodeEntities(q.answer),
    })),
  };
}

function decodeFriendMessage(m: FriendMessage): FriendMessage {
  return { ...m, body: decodeEntities(m.body) };
}

export async function removeFriend(id: number): Promise<void> {
  await api<void>("DELETE", `/api/friends/${id}`);
}

export async function reportFriend(id: number, reason: string): Promise<void> {
  await api<void>("POST", `/api/friends/${id}/report`, { reason });
}

export interface RestoreStreakResult {
  restored: boolean;
  new_streak: number;
  remaining_this_month: number;
  err_code: string;
}

export async function restoreStreak(id: number): Promise<RestoreStreakResult> {
  return api<RestoreStreakResult>("POST", `/api/friends/${id}/streak/restore`, {});
}
