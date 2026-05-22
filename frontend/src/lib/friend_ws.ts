// Client WebSocket pour les chats entre amis (/ws/friend/{id}).
// Reconnexion automatique avec backoff exponentiel borné. Cookie session
// envoyé automatiquement par le navigateur (Domain=.ralys.ovh en prod).
//
// Les `body` reçus du serveur sont HTML-escaped (CLAUDE.md règle d'or #2).
// On les décode ici pour que l'UI consomme du texte propre.

import { decodeEntities } from "@/lib/sanitize";

export interface FriendWSMessage {
  id: number;
  sender_id: number;
  body: string;
  sent_at: string;
}

export type FriendWSEvent =
  | { type: "history"; messages: FriendWSMessage[]; read_at?: string }
  | { type: "msg"; msg: FriendWSMessage }
  | { type: "peer_removed" }
  | { type: "read"; read_at: string }
  | { type: "error"; code: string; message?: string };

export interface FriendWSHandle {
  send(body: string): void;
  close(): void;
}

const WS_BASE = process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? "";

export function openFriendWS(
  friendID: number,
  onEvent: (e: FriendWSEvent) => void,
): FriendWSHandle {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let reopenTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    const url = `${WS_BASE}/ws/friend/${friendID}`;
    ws = new WebSocket(url);
    ws.onopen = () => {
      attempt = 0;
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as FriendWSEvent;
        onEvent(decodeFrame(data));
      } catch {
        // ignore malformed
      }
    };
    ws.onclose = () => {
      if (closed) return;
      // Backoff borné : 1s, 2s, 4s, 8s, 16s (cap).
      const delay = Math.min(16_000, 1_000 * 2 ** attempt);
      attempt += 1;
      reopenTimer = setTimeout(connect, delay);
    };
    ws.onerror = () => {
      // close handler enchaîne la reco
    };
  };

  connect();

  return {
    send(body: string) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "msg", body }));
    },
    close() {
      closed = true;
      if (reopenTimer) clearTimeout(reopenTimer);
      ws?.close();
    },
  };
}

function decodeFrame(e: FriendWSEvent): FriendWSEvent {
  if (e.type === "history") {
    return {
      type: "history",
      messages: (e.messages ?? []).map((m) => ({
        ...m,
        body: decodeEntities(m.body),
      })),
    };
  }
  if (e.type === "msg") {
    return {
      type: "msg",
      msg: { ...e.msg, body: decodeEntities(e.msg.body) },
    };
  }
  return e;
}
