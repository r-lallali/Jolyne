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

  // Le composant n'est rendu que pour les status conversationnels ; on garde
  // un fallback strict pour TypeScript.
  const phase =
    status === "matched" || status === "queued" || status === "connecting"
      ? status
      : "connecting";

  return (
    <div className="flex h-dvh w-full max-w-md flex-col border-x border-neutral-900">
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
