"use client";

import { useCallback } from "react";
import { getFingerprint } from "@/lib/fingerprint";
import { buzz } from "@/lib/haptics";
import { sanitizeMessage } from "@/lib/sanitize";
import { connectMatch, type Connection } from "@/lib/ws";
import { useChatStore } from "@/stores/chatStore";
import { useSessionStore } from "@/stores/sessionStore";

// Connexion WS partagée au niveau du module : `useMatch` est appelé dans
// plusieurs composants (SetupView, ChatView, Conversation), mais il n'y a
// qu'UNE seule WS active dans l'app.
let activeConn: Connection | null = null;

// Listeners "exit" enregistrés une fois au chargement du module.
//   - pagehide / beforeunload : la WS doit être fermée AVANT que le navigateur
//     pose la page en bfcache (Safari/Firefox/Chrome mobile). Sans ça, le
//     peer continue de nous voir "présent" jusqu'à expiration du heartbeat
//     côté serveur (~30 s).
//   - pageshow avec event.persisted : la page est restaurée depuis le
//     bfcache ; la WS qu'on avait fermée est morte. On reset le store pour
//     ne pas laisser le user croire qu'il est encore matché.
if (typeof window !== "undefined") {
  const closeOnExit = () => {
    activeConn?.close();
    activeConn = null;
  };
  window.addEventListener("pagehide", closeOnExit);
  window.addEventListener("beforeunload", closeOnExit);
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      useChatStore.getState().reset();
    }
  });
}

// Throttle des évènements "typing" sortants : on envoie au max une fois par
// 2s. Le serveur les relaie tels quels au peer, qui les utilise pour
// rallumer son indicateur "X écrit…" (auto-clear côté store après 3.5s).
const TYPING_THROTTLE_MS = 2_000;
let lastTypingSent = 0;

// ID éphémère pour ancrer une éventuelle correction. crypto.randomUUID est
// dispo dans tous les navigateurs modernes (HTTPS / localhost). Fallback
// time + random sur les vieux contextes.
function newMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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
            c.matched(f.peer_nick, f.is_bot);
            break;
          case "msg":
            c.pushPeer(f.id ?? newMessageId(), sanitizeMessage(f.body));
            break;
          case "correction":
            c.applyCorrection(f.target_id, {
              original: sanitizeMessage(f.original),
              corrected: sanitizeMessage(f.body),
              note: f.note ? sanitizeMessage(f.note) : undefined,
              fromMe: false,
              at: Date.now(),
            });
            buzz(25);
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
          case "friend_prompt":
            c.showFriendPrompt();
            break;
          case "friend_made":
            c.friendMade(f.friend_id);
            buzz(20);
            break;
          case "friend_skipped":
            c.friendSkipped();
            break;
          case "peer_profile":
            c.setPeerProfile({
              photoId: f.peer_photo_id ?? "",
              prompts: (f.peer_prompts ?? []).map((p) => ({
                prompt: p.prompt,
                answer: sanitizeMessage(p.answer),
              })),
              verified: f.peer_verified,
            });
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
      const id = newMessageId();
      const ok = activeConn?.send({ type: "msg", body, id }) ?? false;
      if (ok) chat.getState().pushMe(id, sanitizeMessage(body));
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

  // Correction d'un message du peer (style HelloTalk). Le serveur relaie au
  // peer, qui voit la correction sous son propre message. Côté local, on
  // patch optimistiquement le store — pas d'écho serveur.
  const correct = useCallback(
    (targetId: string, original: string, corrected: string, note?: string) => {
      const body = corrected.trim();
      if (!body || !targetId) return false;
      const ok =
        activeConn?.send({
          type: "correct",
          target_id: targetId,
          original,
          body,
          note: note?.trim() || undefined,
        }) ?? false;
      if (ok) {
        chat.getState().applyCorrection(targetId, {
          original: sanitizeMessage(original),
          corrected: sanitizeMessage(body),
          note: note?.trim() ? sanitizeMessage(note) : undefined,
          fromMe: true,
          at: Date.now(),
        });
        buzz(15);
      }
      return ok;
    },
    [chat],
  );

  // Accepte le prompt ami (10-min). Le serveur déclenche friend_made si
  // le peer a aussi accepté dans la fenêtre de 60 s.
  const acceptFriend = useCallback(() => {
    const ok = activeConn?.send({ type: "friend_accept" }) ?? false;
    if (ok) {
      chat.getState().selfAcceptFriend();
      buzz(15);
    }
    return ok;
  }, [chat]);

  return { start, sendMsg, sendTyping, next, report, correct, stop, acceptFriend };
}
