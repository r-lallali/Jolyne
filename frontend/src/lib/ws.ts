// Client WebSocket pour /ws/match.
// Reconnexion automatique avec exponential backoff (1s → 16s, cap), pause
// si offline. Voir CLAUDE.md §"WebSocket côté client".

export type ServerFrame =
  | { type: "queued" }
  | { type: "matched"; room: string; peer_nick: string }
  | { type: "msg"; body: string }
  | { type: "peer_left" }
  | { type: "error"; code: string; message?: string };

export type ClientFrame =
  | { type: "msg"; body: string }
  | { type: "next" };

export interface ConnectOpts {
  baseURL: string; // ex: wss://jolyne.ralys.ovh
  params: Record<string, string>;
  onFrame: (f: ServerFrame) => void;
  onStateChange?: (s: ConnState) => void;
}

export type ConnState = "connecting" | "open" | "closed";

export interface Connection {
  send(f: ClientFrame): boolean;
  close(): void;
}

// Codes pour lesquels on n'essaie PAS de se reconnecter — il faut que
// l'utilisateur reprenne la main (corriger pseudo, attendre demain, etc.).
const FATAL_CODES = new Set([
  "invalid_param",
  "invalid_pseudo",
  "quota_exceeded",
]);

const MAX_BACKOFF_MS = 16_000;

export function connectMatch(opts: ConnectOpts): Connection {
  let ws: WebSocket | null = null;
  let closedByUser = false;
  let fatal = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const buildURL = (): string => {
    const u = new URL("/ws/match", opts.baseURL);
    Object.entries(opts.params).forEach(([k, v]) => u.searchParams.set(k, v));
    return u.toString();
  };

  const open = () => {
    const url = buildURL();
    console.info("[ws] open", url);
    opts.onStateChange?.("connecting");
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.info("[ws] connected");
      attempt = 0;
      opts.onStateChange?.("open");
    };

    ws.onmessage = (e) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(e.data) as ServerFrame;
      } catch {
        console.warn("[ws] bad json", e.data);
        return;
      }
      console.info("[ws] in", frame);
      if (frame.type === "error" && FATAL_CODES.has(frame.code)) {
        fatal = true;
      }
      opts.onFrame(frame);
    };

    ws.onclose = (ev) => {
      console.warn(
        "[ws] closed",
        "code=" + ev.code,
        "reason=" + (ev.reason || "(none)"),
        "wasClean=" + ev.wasClean,
      );
      ws = null;
      opts.onStateChange?.("closed");
      if (closedByUser || fatal) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const onOnline = () => {
          window.removeEventListener("online", onOnline);
          schedule();
        };
        window.addEventListener("online", onOnline);
        return;
      }
      schedule();
    };

    ws.onerror = (ev) => {
      console.warn("[ws] error event", ev);
      // L'évènement "close" suit toujours — la reconnexion se gère là-bas.
    };
  };

  const schedule = () => {
    const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!closedByUser && !fatal) open();
    }, delay);
  };

  open();

  return {
    send(f) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn(
          "[ws] send dropped — readyState=",
          ws?.readyState ?? "null",
          "frame=",
          f,
        );
        return false;
      }
      console.info("[ws] out", f);
      ws.send(JSON.stringify(f));
      return true;
    },
    close() {
      closedByUser = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
