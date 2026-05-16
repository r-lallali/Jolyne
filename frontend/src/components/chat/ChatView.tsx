"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { CorrectionModal } from "@/components/chat/CorrectionModal";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { ReportModal } from "@/components/chat/ReportModal";
import { useMatch } from "@/hooks/useMatch";
import { useT } from "@/lib/i18n";
import { useChatStore, type ChatMessage } from "@/stores/chatStore";

// Cooldown anti-zap : on bloque le bouton Suivant pendant 3s après un
// nouveau match. Évite qu'un user fasse "matched → next" sans laisser à
// l'autre le temps d'écrire bonjour.
const NEXT_COOLDOWN_MS = 3_000;

// Toast "Correction envoyée" : ~2.2 s puis fade-out.
const TOAST_MS = 2_200;

export function ChatView() {
  const peerNick = useChatStore((s) => s.peerNick);
  const messageCount = useChatStore((s) => s.messages.length);
  const { sendMsg, sendTyping, next, report, correct, stop } = useMatch();
  const t = useT();
  const [reportOpen, setReportOpen] = useState(false);
  const [target, setTarget] = useState<ChatMessage | null>(null);
  const [canNext, setCanNext] = useState(false);
  const [toastTick, setToastTick] = useState(0); // chaque incrément = un nouveau toast
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (!peerNick) return;
    setCanNext(false);
    const id = setTimeout(() => setCanNext(true), NEXT_COOLDOWN_MS);
    return () => clearTimeout(id);
  }, [peerNick]);

  useEffect(() => {
    if (toastTick === 0) return;
    setShowToast(true);
    const id = setTimeout(() => setShowToast(false), TOAST_MS);
    return () => clearTimeout(id);
  }, [toastTick]);

  // Cmd/Ctrl+K = Suivant. Respecte le cooldown post-match (canNext).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (canNext) next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canNext, next]);

  const handleReport = (reason: string) => {
    report(reason);
  };

  const handleSubmitCorrection = (corrected: string, note: string) => {
    if (!target) return;
    // En mode édition, target.correction existe déjà — on garde target.body
    // comme `original` (le message peer initial), pas la version corrigée.
    correct(target.id, target.body, corrected, note);
    setTarget(null);
    setToastTick((n) => n + 1);
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
        <MessageList
          onCorrect={(m) => setTarget(m)}
          onEditCorrection={(m) => setTarget(m)}
        />
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
        initialCorrected={target?.correction?.corrected}
        initialNote={target?.correction?.note}
        onClose={() => setTarget(null)}
        onSubmit={handleSubmitCorrection}
      />
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="pointer-events-none fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-amber-500/20 px-4 py-1.5 text-xs font-medium text-amber-700 backdrop-blur-sm dark:text-amber-400"
          >
            {t.correction.sentToast}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
