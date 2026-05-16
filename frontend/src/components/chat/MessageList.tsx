"use client";

import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import {
  TranslationPopover,
  type TranslationRequest,
} from "@/components/chat/TranslationPopover";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { useT } from "@/lib/i18n";
import { ICEBREAKERS } from "@/lib/icebreakers";
import { useChatStore, type ChatMessage } from "@/stores/chatStore";
import { useSessionStore } from "@/stores/sessionStore";

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
  const speaks = useSessionStore((s) => s.speaks);
  const wants = useSessionStore((s) => s.wants);
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);

  // Tooltip de traduction. Un seul à la fois — la sélection d'un autre mot
  // remplace simplement la requête en cours.
  const [trans, setTrans] = useState<TranslationRequest | null>(null);

  // Auto-scroll en bas à chaque nouveau message OU quand le peer commence
  // à taper — pour que l'indicateur "X écrit…" reste visible au lieu d'être
  // caché sous le pli.
  useEffect(() => {
    ref.current?.scrollTo({
      top: ref.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, peerTyping]);

  const handleSelect = (text: string, rect: DOMRect) => {
    if (!speaks || !wants) return;
    setTrans({
      text,
      x: rect.left + rect.width / 2,
      y: rect.bottom,
      source: wants, // le peer écrit dans notre `wants`
      target: speaks,
    });
  };

  return (
    <div ref={ref} className="scrollbar-discreet flex-1 overflow-y-auto">
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
                {ICEBREAKERS[wants].map((phrase) => (
                  <button
                    key={phrase}
                    type="button"
                    onClick={() => onIcebreaker(phrase)}
                    className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs text-neutral-700 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                  >
                    {phrase}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((m) => {
            // Édition possible uniquement pour mes propres corrections (qui
            // vivent sous des messages peer).
            const canEdit =
              onEditCorrection &&
              m.from === "peer" &&
              m.correction?.fromMe === true;
            return (
              <MessageBubble
                key={m.id}
                from={m.from}
                body={m.body}
                at={m.at}
                correction={m.correction}
                peerNick={peerNick}
                onSelect={handleSelect}
                onCorrect={onCorrect ? () => onCorrect(m) : undefined}
                onEditCorrection={canEdit ? () => onEditCorrection!(m) : undefined}
              />
            );
          })
        )}
        <TypingIndicator />
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
