"use client";

import { useEffect, useState } from "react";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { CorrectionModal } from "@/components/chat/CorrectionModal";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { ReportModal } from "@/components/chat/ReportModal";
import { useMatch } from "@/hooks/useMatch";
import { useChatStore, type ChatMessage } from "@/stores/chatStore";

// Cooldown anti-zap : on bloque le bouton Suivant pendant 3s après un
// nouveau match. Évite qu'un user fasse "matched → next" sans laisser à
// l'autre le temps d'écrire bonjour.
const NEXT_COOLDOWN_MS = 3_000;

export function ChatView() {
  const peerNick = useChatStore((s) => s.peerNick);
  const messageCount = useChatStore((s) => s.messages.length);
  const { sendMsg, sendTyping, next, report, correct, stop } = useMatch();
  const [reportOpen, setReportOpen] = useState(false);
  const [target, setTarget] = useState<ChatMessage | null>(null);
  const [canNext, setCanNext] = useState(false);

  useEffect(() => {
    if (!peerNick) return;
    setCanNext(false);
    const id = setTimeout(() => setCanNext(true), NEXT_COOLDOWN_MS);
    return () => clearTimeout(id);
  }, [peerNick]);

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
          canReport={messageCount > 0}
          canNext={canNext}
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
