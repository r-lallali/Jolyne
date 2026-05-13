"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { useChatStore } from "@/stores/chatStore";

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const ref = useRef<HTMLDivElement>(null);

  // Auto-scroll en bas à chaque nouveau message — comportement standard.
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [messages.length]);

  return (
    <div ref={ref} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
      {messages.length === 0 ? (
        <p className="pt-8 text-center text-xs text-neutral-600">
          Dis bonjour pour démarrer la conversation.
        </p>
      ) : (
        messages.map((m) => (
          <MessageBubble key={m.id} from={m.from} body={m.body} />
        ))
      )}
    </div>
  );
}
