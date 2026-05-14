"use client";

import { useCallback } from "react";
import { getFingerprint } from "@/lib/fingerprint";
import { sanitizeMessage } from "@/lib/sanitize";
import { connectMatch, type Connection } from "@/lib/ws";
import { useChatStore } from "@/stores/chatStore";
import { useSessionStore } from "@/stores/sessionStore";

// Connexion WS partagée au niveau du module : `useMatch` est appelé dans
// plusieurs composants (SetupView, ChatView, Conversation), mais il n'y a
// qu'UNE seule WS active dans l'app. Un `useRef` local à chaque composant
// créait un ref distinct par appel → SetupView posait la conn dans son ref,
// ChatView lisait son propre ref vide.
let activeConn: Connection | null = null;

export function useMatch() {
  const chat = useChatStore;
  const session = useSessionStore;

  const stop = useCallback(() => {
    activeConn?.close();
    activeConn = null;
    chat.getState().reset();
  }, [chat]);

  const start = useCallback(async () => {
    const { pseudo, speaks, wants, ageAccepted } = session.getState();
    if (!speaks || !wants || !ageAccepted || pseudo.length < 3) return;

    // Ferme une éventuelle conn précédente avant d'en ouvrir une nouvelle.
    activeConn?.close();
    activeConn = null;

    chat.getState().setStatus("connecting");
    const fp = await getFingerprint();
    const baseURL = process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? "";
    if (!baseURL) {
      chat.getState().error("invalid_param");
      return;
    }

    activeConn = connectMatch({
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
        if (s === "closed" && (cur === "matched" || cur === "queued")) {
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
      if (!body) return;
      const ok = activeConn?.send({ type: "msg", body }) ?? false;
      if (ok) chat.getState().pushMe(sanitizeMessage(body));
    },
    [chat],
  );

  const next = useCallback(() => {
    activeConn?.send({ type: "next" });
  }, []);

  return { start, sendMsg, next, stop };
}
