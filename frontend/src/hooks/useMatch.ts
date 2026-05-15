"use client";

import { useCallback } from "react";
import { getFingerprint } from "@/lib/fingerprint";
import { sanitizeMessage } from "@/lib/sanitize";
import { connectMatch, type Connection } from "@/lib/ws";
import { useChatStore } from "@/stores/chatStore";
import { useSessionStore } from "@/stores/sessionStore";

// Connexion WS partagée au niveau du module : `useMatch` est appelé dans
// plusieurs composants (SetupView, ChatView, Conversation), mais il n'y a
// qu'UNE seule WS active dans l'app.
let activeConn: Connection | null = null;

// Throttle des évènements "typing" sortants : on envoie au max une fois par
// 2s. Le serveur les relaie tels quels au peer, qui les utilise pour
// rallumer son indicateur "X écrit…" (auto-clear côté store après 3.5s).
const TYPING_THROTTLE_MS = 2_000;
let lastTypingSent = 0;

export function useMatch() {
  const chat = useChatStore;
  const session = useSessionStore;

  const stop = useCallback(() => {
    activeConn?.close();
    activeConn = null;
    lastTypingSent = 0;
    // Transition vers l'écran "Merci, à bientôt" — la FarewellView reset
    // le store à idle après ~2s.
    chat.getState().farewell();
  }, [chat]);

  const start = useCallback(async () => {
    const { pseudo, speaks, wants, ageAccepted } = session.getState();
    if (!speaks || !wants || !ageAccepted || pseudo.length < 3) return;

    activeConn?.close();
    activeConn = null;
    lastTypingSent = 0;

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
          case "typing":
            c.receivePeerTyping();
            break;
          case "reported":
            // Le serveur enchaîne avec un peer_left/queued, la transition
            // d'UI se fait via ces évènements. On ne touche pas au store.
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

  // Throttle côté client : 1 émission max toutes les 2s, peu importe la
  // fréquence des frappes.
  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent < TYPING_THROTTLE_MS) return;
    if (chat.getState().status !== "matched") return;
    lastTypingSent = now;
    activeConn?.send({ type: "typing" });
  }, [chat]);

  const next = useCallback(() => {
    lastTypingSent = 0;
    activeConn?.send({ type: "next" });
  }, []);

  // Signalement du peer courant. Côté serveur : capture les derniers
  // messages, les chiffre, persiste en Postgres et auto-quitte la conv
  // (équivalent à un peer_left). `reason` est optionnel (≤ 500 chars).
  const report = useCallback((reason?: string) => {
    if (!activeConn) return false;
    lastTypingSent = 0;
    return activeConn.send({ type: "report", body: reason });
  }, []);

  return { start, sendMsg, sendTyping, next, report, stop };
}
