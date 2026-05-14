"use client";

import { ChatHeader } from "@/components/chat/ChatHeader";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { useMatch } from "@/hooks/useMatch";
import { useChatStore } from "@/stores/chatStore";

export function ChatView() {
  const status = useChatStore((s) => s.status);
  const peerNick = useChatStore((s) => s.peerNick);
  const { sendMsg, next, stop } = useMatch();

  const phase =
    status === "matched" || status === "queued" || status === "connecting"
      ? status
      : "connecting";

  return (
    <div className="flex h-dvh w-full flex-col bg-neutral-950 sm:h-[88vh] sm:max-w-3xl sm:overflow-hidden sm:rounded-2xl sm:border sm:border-neutral-900/70 sm:bg-neutral-950/40 sm:shadow-2xl sm:backdrop-blur">
      <ChatHeader
        peerNick={peerNick}
        status={phase}
        onNext={next}
        onStop={stop}
      />
      <MessageList />
      <MessageInput onSend={sendMsg} disabled={status !== "matched"} />
    </div>
  );
}
