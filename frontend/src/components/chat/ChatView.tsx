"use client";

import { ChatHeader } from "@/components/chat/ChatHeader";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { useMatch } from "@/hooks/useMatch";
import { useChatStore } from "@/stores/chatStore";

// ChatView n'est rendu QUE lorsque status === "matched" — c'est
// Conversation qui route. Du coup pas de logique d'état dans ce composant,
// on assume l'input toujours actif et le peer présent.
export function ChatView() {
  const peerNick = useChatStore((s) => s.peerNick);
  const { sendMsg, next, stop } = useMatch();

  return (
    <div className="flex h-dvh w-full flex-col bg-neutral-950 sm:h-[88vh] sm:max-w-3xl sm:overflow-hidden sm:rounded-2xl sm:border sm:border-neutral-900/70 sm:bg-neutral-950/40 sm:shadow-2xl sm:backdrop-blur">
      <ChatHeader peerNick={peerNick} onNext={next} onStop={stop} />
      <MessageList />
      <MessageInput onSend={sendMsg} disabled={false} />
    </div>
  );
}
