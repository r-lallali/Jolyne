// Client WebSocket pour l'inbox global (/ws/inbox). Une seule connexion
// par session — agrège les events de TOUTES les conversations friend du
// user. Permet d'incrémenter les unread + déclencher des toasts en live
// sans avoir à ouvrir chaque conv.
//
// Snapshot des conversations pris à la connexion côté serveur — si l'user
// ajoute / retire un ami pendant la session, appeler `reconnect()` pour
// re-souscrire à la nouvelle liste de channels.

import { decodeEntities } from "@/lib/sanitize";

export type InboxEvent =
  | { type: "msg"; friend_id: number; sender_id: number; preview: string; sent_at: string }
  | { type: "read"; friend_id: number }
  | { type: "removed"; friend_id: number }
  | { type: "friends_changed" };

export interface InboxHandle {
  reconnect(): void;
  close(): void;
}

const WS_BASE = process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? "";

export function openInboxWS(onEvent: (e: InboxEvent) => void): InboxHandle {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let reopenTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    const url = `${WS_BASE}/ws/inbox`;
    ws = new WebSocket(url);
    ws.onopen = () => {
      attempt = 0;
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as InboxEvent;
        if (data.type === "msg") {
          onEvent({ ...data, preview: decodeEntities(data.preview ?? "") });
        } else {
          onEvent(data);
        }
      } catch {
        // ignore malformed
      }
    };
    ws.onclose = () => {
      if (closed) return;
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
    reconnect() {
      if (closed) return;
      if (reopenTimer) {
        clearTimeout(reopenTimer);
        reopenTimer = null;
      }
      ws?.close();
      attempt = 0;
      connect();
    },
    close() {
      closed = true;
      if (reopenTimer) clearTimeout(reopenTimer);
      ws?.close();
    },
  };
}
