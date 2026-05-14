"use client";

import { useCallback, useEffect, useRef } from "react";
import { getFingerprint } from "@/lib/fingerprint";
import { sanitizeMessage } from "@/lib/sanitize";
import { connectMatch, type Connection } from "@/lib/ws";
import { useChatStore } from "@/stores/chatStore";
import { useSessionStore } from "@/stores/sessionStore";

// useMatch encapsule l'orchestration WS ↔ stores. Une seule instance vivante
// à la fois (le hook gère son cycle de vie via useRef).
export function useMatch() {
  const conn = useRef<Connection | null>(null);
  const chat = useChatStore;
  const session = useSessionStore;

  const stop = useCallback(() => {
    conn.current?.close();
    conn.current = null;
    chat.getState().reset();
  }, [chat]);

  const start = useCallback(async () => {
    const { pseudo, speaks, wants, ageAccepted } = session.getState();
    if (!speaks || !wants || !ageAccepted || pseudo.length < 3) return;

    chat.getState().setStatus("connecting");
    const fp = await getFingerprint();
    const baseURL = process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? "";
    if (!baseURL) {
      chat.getState().error("invalid_param");
      return;
    }

    conn.current = connectMatch({
      baseURL,
      params: {
        nick: pseudo,
        speaks,
        wants,
        fp,
        age: "ok",
      },
      onStateChange: (s) => {
        const cur = chat.getState().status;
        console.info("[match] ws state →", s, "chat status was=", cur);
        if (s === "closed" && (cur === "matched" || cur === "queued")) {
          chat.getState().setStatus("connecting");
        }
        if (s === "connecting" && cur === "matched") {
          chat.getState().setStatus("connecting");
        }
      },
      onFrame: (f) => {
        const c = chat.getState();
        switch (f.type) {
          case "queued":
            c.setStatus("queued");
            break;
          case "matched":
            c.matched(f.peer_nick);
            break;
          case "msg":
            c.pushPeer(sanitizeMessage(f.body));
            break;
          case "peer_left":
            c.peerLeft();
            break;
          case "error":
            c.error(f.code, f.message);
            break;
        }
      },
    });
  }, [chat, session]);

  const sendMsg = useCallback(
    (raw: string) => {
      const body = raw.trim();
      console.info(
        "[match] sendMsg called body=",
        body,
        "hasConn=",
        conn.current !== null,
        "status=",
        chat.getState().status,
      );
      if (!body) return;
      const ok = conn.current?.send({ type: "msg", body }) ?? false;
      console.info("[match] sendMsg result ok=", ok);
      if (ok) chat.getState().pushMe(sanitizeMessage(body));
    },
    [chat],
  );

  const next = useCallback(() => {
    conn.current?.send({ type: "next" });
  }, []);

  useEffect(() => {
    return () => {
      conn.current?.close();
      conn.current = null;
    };
  }, []);

  return { start, sendMsg, next, stop };
}
