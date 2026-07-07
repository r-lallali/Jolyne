"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { FriendPromptCard } from "@/components/chat/FriendPromptCard";
import { PostChatCard } from "@/components/chat/PostChatCard";
import { SystemMessage } from "@/components/chat/SystemMessage";
import {
  TranslationPopover,
  type TranslationRequest,
} from "@/components/chat/TranslationPopover";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { useT } from "@/lib/i18n";
import { useAutoTranslations } from "@/lib/autoTranslate";
import { guessSourceLang } from "@/lib/translate";
import { ICEBREAKERS } from "@/lib/icebreakers";
import { track } from "@/lib/track";
import { useChatStore, type ChatMessage } from "@/stores/chatStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUserStore } from "@/stores/userStore";

// Flag localStorage : "le user a déjà vu le hint, ne pas réafficher".
const HINT_STORAGE_KEY = "jolyne_translate_hinted";
const HINT_AUTO_DISMISS_MS = 8_000;

interface Props {
  onCorrect?: (m: ChatMessage) => void;
  onEditCorrection?: (m: ChatMessage) => void;
  // Permet à l'écran vide de proposer des amorces cliquables qui envoient
  // directement la phrase (court-circuit du champ texte).
  onIcebreaker?: (text: string) => void;
}

export function MessageList({
  onCorrect,
  onEditCorrection,
  onIcebreaker,
}: Props) {
  const messages = useChatStore((s) => s.messages);
  const peerNick = useChatStore((s) => s.peerNick);
  const peerTyping = useChatStore((s) => s.peerTyping);
  const status = useChatStore((s) => s.status);
  // Voir ChatView : on garde la PostChatCard sur tout status ≠ "matched"
  // pour éviter le flash pendant la sortie d'AnimatePresence vers "ended".
  const postChat = status !== "matched";
  const friendPrompt = useChatStore((s) => s.friendPrompt);
  // Amorces fraîches du serveur si arrivées, sinon fallback statique local.
  const freshIcebreakers = useChatStore((s) => s.icebreakers);
  const speaks = useSessionStore((s) => s.speaks);
  const wants = useSessionStore((s) => s.wants);
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);

  // Mode immersion (Premium) : traduction auto des messages du peer,
  // affichée sous chaque bulle. Borné aux 30 derniers pour ne pas traduire
  // tout un historique d'un coup.
  const autoTranslate = useSessionStore((s) => s.autoTranslate);
  const user = useUserStore((s) => s.user);
  const immersionOn = autoTranslate && !!user?.is_premium;
  const peerItems = useMemo(
    () =>
      messages
        .filter((m) => m.from === "peer" && m.kind !== "system" && m.body)
        .slice(-30)
        .map((m) => ({ id: m.id, body: m.body })),
    [messages],
  );
  const autoTrans = useAutoTranslations(peerItems, {
    enabled: immersionOn,
    expected: wants,
    target: speaks,
  });

  // Tooltip de traduction. Un seul à la fois — la sélection d'un autre mot
  // remplace simplement la requête en cours.
  const [trans, setTrans] = useState<TranslationRequest | null>(null);

  // Hint "touche un mot pour le traduire" ancré sur le 1er message peer
  // de la 1ère session. Une fois vu (tap ou timeout), persistance
  // localStorage pour ne plus jamais le réafficher.
  const [hintShown, setHintShown] = useState(false);
  const firstPeerIdx = messages.findIndex(
    (m) => m.from === "peer" && m.kind !== "system",
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(HINT_STORAGE_KEY) === "1") return;
    if (firstPeerIdx === -1) return;
    setHintShown(true);
  }, [firstPeerIdx]);
  const dismissHint = () => {
    if (!hintShown) return;
    setHintShown(false);
    try {
      window.localStorage.setItem(HINT_STORAGE_KEY, "1");
    } catch {
      // localStorage indispo (mode privé Safari) — tant pis, le hint
      // réapparaîtra à la prochaine session.
    }
  };
  useEffect(() => {
    if (!hintShown) return;
    const id = setTimeout(dismissHint, HINT_AUTO_DISMISS_MS);
    return () => clearTimeout(id);
    // dismissHint stable car n'utilise pas de var locale dépendante.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintShown]);

  // Auto-scroll en bas à chaque nouveau message OU quand le peer commence
  // à taper — pour que l'indicateur "X écrit…" reste visible au lieu d'être
  // caché sous le pli.
  useEffect(() => {
    ref.current?.scrollTo({
      top: ref.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, peerTyping, postChat, friendPrompt]);

  const handleSelect = (text: string, rect: DOMRect) => {
    dismissHint();
    if (!speaks || !wants) return;
    setTrans({
      text,
      x: rect.left + rect.width / 2,
      y: rect.bottom,
      // Le peer écrit en général dans notre `wants`, mais pas toujours
      // (alternance des langues en tandem). Le script du texte tranche
      // pour zh/ja/ko/ar ; sinon `wants`, ou "auto" en dernier recours.
      source: guessSourceLang(text, wants),
      target: speaks,
    });
  };

  return (
    <div
      ref={ref}
      className="scrollbar-discreet flex-1 overflow-y-auto overscroll-contain"
    >
      <div className="mx-auto w-full max-w-2xl space-y-2 px-4 py-4 sm:px-6">
        {messages.length === 0 ? (
          <div className="flex h-[40dvh] flex-col items-center justify-center gap-5">
            <div className="text-center">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {t.chat.chattingWith({ nick: peerNick ?? "" })}
              </p>
              <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-600">
                {t.chat.sayHello}
              </p>
            </div>
            {wants && onIcebreaker && (
              <div className="flex max-w-md flex-wrap justify-center gap-2">
                {(freshIcebreakers.length > 0
                  ? freshIcebreakers
                  : ICEBREAKERS[wants]
                ).map((phrase) => (
                  <button
                    key={phrase}
                    type="button"
                    onClick={() => {
                      void track("icebreaker_used", { lang_to: wants });
                      onIcebreaker(phrase);
                    }}
                    className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs text-neutral-700 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                  >
                    {phrase}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((m, i) => {
            if (m.kind === "system") {
              return <SystemMessage key={m.id} body={m.body} />;
            }
            // Édition possible uniquement pour mes propres corrections (qui
            // vivent sous des messages peer).
            const canEdit =
              onEditCorrection &&
              m.from === "peer" &&
              m.correction?.fromMe === true;
            return (
              <Fragment key={m.id}>
                {hintShown && i === firstPeerIdx && (
                  <div className="flex justify-start">
                    <button
                      type="button"
                      onClick={dismissHint}
                      className="rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-500/25 dark:text-emerald-400"
                    >
                      💡 {t.chat.tapToTranslate}
                    </button>
                  </div>
                )}
                <MessageBubble
                  from={m.from}
                  body={m.body}
                  at={m.at}
                  correction={m.correction}
                  peerNick={peerNick}
                  onSelect={handleSelect}
                  onCorrect={onCorrect ? () => onCorrect(m) : undefined}
                  onEditCorrection={canEdit ? () => onEditCorrection!(m) : undefined}
                  translation={
                    m.from === "peer" ? autoTrans[m.id] : undefined
                  }
                />
              </Fragment>
            );
          })
        )}
        <TypingIndicator />
        {friendPrompt && <FriendPromptCard />}
        {postChat && <PostChatCard />}
      </div>
      {trans && (
        <TranslationPopover
          request={trans}
          onClose={() => setTrans(null)}
        />
      )}
    </div>
  );
}
