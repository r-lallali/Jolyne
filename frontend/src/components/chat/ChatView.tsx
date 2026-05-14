"use client";

import { ChatHeader } from "@/components/chat/ChatHeader";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { useMatch } from "@/hooks/useMatch";
import { useChatStore } from "@/stores/chatStore";

// Volontairement épuré : aucun bord, aucun fond opaque, aucune ombre.
// Le body de la page fournit la couleur de fond, le chat respire dedans.
// Sur mobile : pleine hauteur. Sur desktop : centré, max-w-3xl.
// Le wordmark Jolyne est rendu au niveau de layout.tsx (cf. ChatWordmark).
export function ChatView() {
  const peerNick = useChatStore((s) => s.peerNick);
  const { sendMsg, next, stop } = useMatch();
  return (
    <div className="flex h-dvh w-full flex-col sm:h-[92vh] sm:max-w-3xl">
      <ChatHeader peerNick={peerNick} onNext={next} onStop={stop} />
      <MessageList />
      <MessageInput onSend={sendMsg} disabled={false} />
    </div>
  );
}
