"use client";

import { ChatHeader } from "@/components/chat/ChatHeader";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { useMatch } from "@/hooks/useMatch";
import { useChatStore } from "@/stores/chatStore";

// Volontairement épuré : aucun bord, aucun fond opaque, aucune ombre.
// Le body de la page fournit la couleur de fond, le chat respire dedans.
// Sur mobile : pleine hauteur. Sur desktop : centré, max-w-3xl.
//
// Le wordmark Jolyne (gros, top-left) n'apparaît QUE sur cette vue — pour
// rappeler la marque pendant la conversation. Caché sur mobile : la barre
// de chat porte déjà ce qu'il faut.
export function ChatView() {
  const peerNick = useChatStore((s) => s.peerNick);
  const { sendMsg, next, stop } = useMatch();
  return (
    <>
      <p className="pointer-events-none fixed left-5 top-3 z-40 hidden text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:block">
        Jolyne
      </p>
      <div className="flex h-dvh w-full flex-col sm:h-[92vh] sm:max-w-3xl">
        <ChatHeader peerNick={peerNick} onNext={next} onStop={stop} />
        <MessageList />
        <MessageInput onSend={sendMsg} disabled={false} />
      </div>
    </>
  );
}
