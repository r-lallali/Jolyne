"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { BackGuardModal } from "@/components/chat/BackGuardModal";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { CorrectionModal } from "@/components/chat/CorrectionModal";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { ReportModal } from "@/components/chat/ReportModal";
import { useMatch } from "@/hooks/useMatch";
import { useTabAttention } from "@/hooks/useTabAttention";
import { useT } from "@/lib/i18n";
import { useChatStore, type ChatMessage } from "@/stores/chatStore";

// Cooldown anti-zap : on bloque le bouton Suivant pendant 3s après un
// nouveau match. Évite qu'un user fasse "matched → next" sans laisser à
// l'autre le temps d'écrire bonjour. Le temps restant est exposé en prop
// pour le ring countdown autour du bouton.
export const NEXT_COOLDOWN_MS = 3_000;

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
  // Timestamp du match courant pour piloter le ring countdown dans le
  // header. Reset à chaque nouveau peer.
  const [cooldownStart, setCooldownStart] = useState<number | null>(null);
  const [toastTick, setToastTick] = useState(0); // chaque incrément = un nouveau toast
  const [showToast, setShowToast] = useState(false);
  const [backGuard, setBackGuard] = useState(false);
  // Skipper notre propre popstate quand on confirme le back (sinon on
  // re-trap notre propre history.back).
  const skipNextPop = useRef(false);

  useTabAttention();

  // Intercepte le bouton "retour" du navigateur. On pousse un état leurre
  // ; au popstate, on re-push pour rester sur la page et on ouvre la modale
  // de confirmation. Confirm = on retire le listener et on appelle vraiment
  // history.back(). Cancel = on reste.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.history.pushState({ jolyne: "back-guard" }, "", window.location.href);
    const onPop = () => {
      if (skipNextPop.current) {
        skipNextPop.current = false;
        return;
      }
      window.history.pushState(
        { jolyne: "back-guard" },
        "",
        window.location.href,
      );
      setBackGuard(true);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!peerNick) {
      setCooldownStart(null);
      return;
    }
    setCanNext(false);
    setCooldownStart(Date.now());
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

  const cancelBack = () => setBackGuard(false);

  const confirmBack = () => {
    setBackGuard(false);
    // Coupe le WS et reset le store *avant* de naviguer pour que le peer
    // reçoive le Left immédiatement. Le flag skipNextPop évite que notre
    // propre history.back() re-déclenche la modale.
    stop();
    skipNextPop.current = true;
    window.history.back();
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
          cooldownStart={cooldownStart}
          cooldownMs={NEXT_COOLDOWN_MS}
        />
        <MessageList
          onCorrect={(m) => setTarget(m)}
          onEditCorrection={(m) => setTarget(m)}
          onIcebreaker={(phrase) => sendMsg(phrase)}
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
      <BackGuardModal
        open={backGuard}
        onCancel={cancelBack}
        onConfirm={confirmBack}
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
