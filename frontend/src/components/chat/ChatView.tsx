"use client";

import { ChatHeader } from "@/components/chat/ChatHeader";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { useMatch } from "@/hooks/useMatch";
import { useChatStore } from "@/stores/chatStore";

export function ChatView() {
  const peerNick = useChatStore((s) => s.peerNick);
  const { sendMsg, sendTyping, next, stop } = useMatch();
  return (
    <div className="flex h-dvh w-full flex-col sm:h-[92vh] sm:max-w-3xl">
      <ChatHeader peerNick={peerNick} onNext={next} onStop={stop} />
      <MessageList />
      <TypingIndicator />
      <MessageInput onSend={sendMsg} onTyping={sendTyping} disabled={false} />
    </div>
  );
}
