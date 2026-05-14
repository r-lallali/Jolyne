"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { useChatStore } from "@/stores/chatStore";

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const peerNick = useChatStore((s) => s.peerNick);
  const ref = useRef<HTMLDivElement>(null);

  // Auto-scroll en bas à chaque nouveau message — smooth pour avoir un
  // effet d'arrivée plutôt qu'un saut sec.
  useEffect(() => {
    ref.current?.scrollTo({
      top: ref.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  return (
    <div
      ref={ref}
      className="scrollbar-discreet flex-1 space-y-2 overflow-y-auto px-4 py-4"
    >
      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-neutral-400">
              Connecté avec{" "}
              <span className="font-medium text-neutral-100">{peerNick}</span>
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              Dis bonjour pour démarrer la conversation.
            </p>
          </div>
        </div>
      ) : (
        messages.map((m) => (
          <MessageBubble key={m.id} from={m.from} body={m.body} />
        ))
      )}
    </div>
  );
}
