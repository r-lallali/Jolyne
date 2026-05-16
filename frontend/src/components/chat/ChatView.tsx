"use client";

import { useState } from "react";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { CorrectionModal } from "@/components/chat/CorrectionModal";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { ReportModal } from "@/components/chat/ReportModal";
import { useMatch } from "@/hooks/useMatch";
import { useChatStore, type ChatMessage } from "@/stores/chatStore";

export function ChatView() {
  const peerNick = useChatStore((s) => s.peerNick);
  const { sendMsg, sendTyping, next, report, correct, stop } = useMatch();
  const [reportOpen, setReportOpen] = useState(false);
  const [target, setTarget] = useState<ChatMessage | null>(null);

  const handleReport = (reason: string) => {
    report(reason);
  };

  const handleSubmitCorrection = (corrected: string, note: string) => {
    if (!target) return;
    correct(target.id, target.body, corrected, note);
    setTarget(null);
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
        <MessageList onCorrect={(m) => setTarget(m)} />
        <MessageInput onSend={sendMsg} onTyping={sendTyping} disabled={false} />
      </div>
      <ReportModal
        open={reportOpen}
        peerNick={peerNick}
        onClose={() => setReportOpen(false)}
        onSubmit={handleReport}
      />
      <CorrectionModal
        open={target !== null}
        original={target?.body ?? ""}
        peerNick={peerNick}
        onClose={() => setTarget(null)}
        onSubmit={handleSubmitCorrection}
      />
    </>
  );
}
