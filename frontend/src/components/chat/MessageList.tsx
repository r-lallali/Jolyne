"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { useChatStore } from "@/stores/chatStore";

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const peerNick = useChatStore((s) => s.peerNick);
  const peerTyping = useChatStore((s) => s.peerTyping);
  const ref = useRef<HTMLDivElement>(null);

  // Auto-scroll en bas à chaque nouveau message OU quand le peer commence
  // à taper — pour que l'indicateur "X écrit…" reste visible au lieu d'être
  // caché sous le pli.
  useEffect(() => {
    ref.current?.scrollTo({
      top: ref.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, peerTyping]);

  return (
    <div ref={ref} className="scrollbar-discreet flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-2 px-4 py-4 sm:px-6">
        {messages.length === 0 ? (
          <div className="flex h-[40dvh] items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Tu discutes avec{" "}
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {peerNick}
                </span>
              </p>
              <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-600">
                Dis bonjour pour démarrer.
              </p>
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble key={m.id} from={m.from} body={m.body} />
          ))
        )}
        <TypingIndicator />
      </div>
    </div>
  );
}
