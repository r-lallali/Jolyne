// Client HTTP /api/friends/*. credentials:include partout (cookie session
// user requis pour toutes ces routes).

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export interface FriendSummary {
  id: number;
  peer_id: number;
  peer_name: string;
  peer_photo_id?: string;
  created_at: string;
  last_message_at: string;
}

export interface FriendMessage {
  id: number;
  sender_id: number;
  body: string;
  sent_at: string;
}

export interface FriendProfile {
  peer_id: number;
  display_name: string;
  bio: string;
  birthdate: string | null;
  photos: { position: number; public_id: string }[];
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
  return d.friends ?? [];
}

export async function getFriendMessages(id: number): Promise<FriendMessage[]> {
  const d = await api<{ messages: FriendMessage[] }>(
    "GET",
    `/api/friends/${id}/messages`,
  );
  return d.messages ?? [];
}

export async function postFriendMessage(id: number, body: string): Promise<FriendMessage> {
  return api<FriendMessage>("POST", `/api/friends/${id}/messages`, { body });
}

export async function getFriendProfile(id: number): Promise<FriendProfile> {
  return api<FriendProfile>("GET", `/api/friends/${id}/profile`);
}

export async function removeFriend(id: number): Promise<void> {
  await api<void>("DELETE", `/api/friends/${id}`);
}
