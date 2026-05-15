"use client";

import { useState } from "react";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { ReportModal } from "@/components/chat/ReportModal";
import { useMatch } from "@/hooks/useMatch";
import { useChatStore } from "@/stores/chatStore";

export function ChatView() {
  const peerNick = useChatStore((s) => s.peerNick);
  const { sendMsg, sendTyping, next, report, stop } = useMatch();
  const [reportOpen, setReportOpen] = useState(false);

  const handleReport = (reason: string) => {
    report(reason);
  };

  return (
    <>
      <div className="flex h-dvh w-full flex-col sm:h-[92vh] sm:max-w-3xl">
        <ChatHeader
          peerNick={peerNick}
          onNext={next}
          onStop={stop}
          onReport={() => setReportOpen(true)}
        />
        <MessageList />
        <MessageInput onSend={sendMsg} onTyping={sendTyping} disabled={false} />
      </div>
      <ReportModal
        open={reportOpen}
        peerNick={peerNick}
        onClose={() => setReportOpen(false)}
        onSubmit={handleReport}
      />
    </>
  );
}
