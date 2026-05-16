"use client";

import { useEffect, useRef } from "react";
import { useChatStore } from "@/stores/chatStore";

// useTabAttention patche document.title quand on reçoit un message peer
// alors que l'onglet est en arrière-plan. Reset au prochain visibilitychange
// → visible. Ne fait rien tant qu'on est focus.
//
// Compteur cumulatif "(N) Jolyne" tant qu'on n'a pas revisualisé l'onglet.
const BASE_TITLE = "Jolyne";

export function useTabAttention() {
  const peerMessageCount = useChatStore(
    (s) => s.messages.filter((m) => m.from === "peer").length,
  );
  const seen = useRef(peerMessageCount);
  const unread = useRef(0);

  useEffect(() => {
    const refresh = () => {
      if (typeof document === "undefined") return;
      document.title = unread.current > 0
        ? `(${unread.current}) ${BASE_TITLE}`
        : BASE_TITLE;
    };

    if (peerMessageCount > seen.current) {
      const delta = peerMessageCount - seen.current;
      seen.current = peerMessageCount;
      if (typeof document !== "undefined" && document.hidden) {
        unread.current += delta;
        refresh();
      }
    }

    const onVisible = () => {
      if (typeof document === "undefined" || document.hidden) return;
      unread.current = 0;
      seen.current = peerMessageCount;
      refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [peerMessageCount]);

  // Reset propre du titre quand le hook se démonte (sortie de chat).
  useEffect(
    () => () => {
      if (typeof document !== "undefined") document.title = BASE_TITLE;
    },
    [],
  );
}
