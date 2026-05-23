"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { BackGuardModal } from "@/components/chat/BackGuardModal";
import { BotIntroToast } from "@/components/chat/BotIntroToast";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { CorrectionModal } from "@/components/chat/CorrectionModal";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { ReportModal } from "@/components/chat/ReportModal";
import { useMatch } from "@/hooks/useMatch";
import { useTabAttention } from "@/hooks/useTabAttention";
import { fetchCloudName } from "@/lib/account";
import { useT } from "@/lib/i18n";
import { isPromptKey } from "@/lib/prompts";
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
  const status = useChatStore((s) => s.status);
  const messageCount = useChatStore((s) => s.messages.length);
  const peerProfile = useChatStore((s) => s.peerProfile);
  const peerIsBot = useChatStore((s) => s.peerIsBot);
  const matchedAt = useChatStore((s) => s.matchedAt);
  const [cloudName, setCloudName] = useState("");
  useEffect(() => {
    fetchCloudName().then(setCloudName).catch(() => {});
  }, []);
  const { sendMsg, sendTyping, next, report, correct, stop } = useMatch();
  const t = useT();
  // Tout ce qui n'est pas "matched" doit cacher l'input et garder la
  // PostChatCard : sans ça, quand on clique Quitter en post_chat, status
  // bascule sur "ended" pendant que l'AnimatePresence anime la sortie de
  // ChatView — l'input réapparait brièvement et la card disparait, ce qui
  // donne un flash très visible.
  const postChat = status !== "matched";
  const [reportOpen, setReportOpen] = useState(false);
  const [target, setTarget] = useState<ChatMessage | null>(null);
  // canNext devient true `NEXT_COOLDOWN_MS` après `matchedAt`. On dérive
  // l'état initial pour qu'un remount (switch d'onglet "mes conversations"
  // → retour) ne replonge pas le bouton dans le cooldown si la fenêtre est
  // déjà écoulée.
  const [canNext, setCanNext] = useState(() =>
    matchedAt !== null && Date.now() - matchedAt >= NEXT_COOLDOWN_MS,
  );
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

  // Cooldown anti-zap ancré sur `matchedAt` (store). À chaque changement
  // de matchedAt OU au mount, on calcule le temps restant : si déjà
  // écoulé → canNext immédiatement, sinon timer pour la durée restante.
  // Ne dépend PAS du cycle de vie du composant : un mode switch qui
  // remonte ChatView ne relance pas l'animation.
  useEffect(() => {
    if (matchedAt === null) {
      setCanNext(false);
      return;
    }
    const elapsed = Date.now() - matchedAt;
    if (elapsed >= NEXT_COOLDOWN_MS) {
      setCanNext(true);
      return;
    }
    setCanNext(false);
    const id = setTimeout(
      () => setCanNext(true),
      NEXT_COOLDOWN_MS - elapsed,
    );
    return () => clearTimeout(id);
  }, [matchedAt]);

  // Ring n'apparait que pendant la fenêtre active du cooldown — basé sur
  // matchedAt + canNext, donc auto-derivé (pas de state séparé).
  const cooldownActive =
    !postChat &&
    matchedAt !== null &&
    !canNext &&
    Date.now() - matchedAt < NEXT_COOLDOWN_MS;
  const cooldownStart = cooldownActive ? matchedAt : null;

  useEffect(() => {
    if (toastTick === 0) return;
    setShowToast(true);
    const id = setTimeout(() => setShowToast(false), TOAST_MS);
    return () => clearTimeout(id);
  }, [toastTick]);

  // Cmd/Ctrl+K = Suivant immédiat. Respecte le cooldown post-match
  // (canNext) — pas de PostChatCard pour celui qui déclenche.
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
      <div className="flex h-dvh w-full flex-col pt-[calc(env(safe-area-inset-top)+2.5rem)] sm:h-[92vh] sm:max-w-3xl sm:pt-0">
        <ChatHeader
          peerNick={peerNick}
          peerPhotoId={peerProfile?.photoId}
          cloudName={cloudName}
          onNext={next}
          onStop={stop}
          onReport={() => setReportOpen(true)}
          canReport={messageCount > 0 && !postChat}
          canNext={canNext && !postChat}
          postChat={postChat}
          cooldownStart={cooldownStart}
          cooldownMs={NEXT_COOLDOWN_MS}
          peerVerified={peerProfile?.verified}
          peerIsBot={peerIsBot}
        />
        <BotIntroToast show={peerIsBot && status === "matched"} />
        {peerProfile &&
          peerProfile.prompts.some((p) => p.prompt && p.answer) && (
            <PeerPromptStrip prompts={peerProfile.prompts} />
          )}
        <MessageList
          onCorrect={postChat ? undefined : (m) => setTarget(m)}
          onEditCorrection={postChat ? undefined : (m) => setTarget(m)}
          onIcebreaker={postChat ? undefined : (phrase) => sendMsg(phrase)}
        />
        {!postChat && (
          <MessageInput
            onSend={sendMsg}
            onTyping={sendTyping}
            disabled={false}
          />
        )}
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

// PeerPromptStrip : carrousel horizontal scrollable des 3 prompts du peer,
// affiché entre le header et la liste de messages. Évite de bouffer la
// hauteur de chat sur mobile (pas un side panel — `max-w-3xl` est trop
// étroit pour un sidebar lisible).
function PeerPromptStrip({
  prompts,
}: {
  prompts: { prompt: string; answer: string }[];
}) {
  const t = useT();
  const visible = prompts.filter((p) => p.prompt && p.answer);
  if (visible.length === 0) return null;
  return (
    <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800 sm:px-6">
      <div className="scrollbar-discreet -mx-1 flex gap-2 overflow-x-auto px-1">
        {visible.map((p, i) => (
          <div
            key={i}
            className="min-w-[14rem] shrink-0 rounded-2xl bg-neutral-100 px-3 py-2 dark:bg-neutral-900"
          >
            <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              {isPromptKey(p.prompt) ? t.prompts[p.prompt] : p.prompt}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-xs text-neutral-800 dark:text-neutral-200">
              {p.answer}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
