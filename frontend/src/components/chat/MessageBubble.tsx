"use client";

import { motion } from "framer-motion";
import { useRef } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { MessageCorrection } from "@/stores/chatStore";

interface Props {
  from: "me" | "peer";
  body: string;
  correction?: MessageCorrection;
  peerNick: string | null;
  // Appelé quand l'utilisateur sélectionne du texte dans une bulle peer.
  // Permet à la liste d'ancrer un tooltip de traduction.
  onSelect?: (text: string, rect: DOMRect) => void;
  // Demande l'ouverture du modal de correction sur ce message (bulles peer
  // uniquement, et seulement si aucune correction n'a déjà été envoyée).
  onCorrect?: () => void;
}

// Bulles asymétriques :
//   - moi  : alignées à droite, fond inversé (sombre en light, clair en dark)
//   - peer : alignées à gauche, fond doux (gris clair en light, gris foncé en dark)
//
// Quand une correction existe, elle s'affiche en sous-bulle juste sous le
// message original — même alignement que la bulle parente.
// Délai pour distinguer un long-press (= traduire le mot tapé) d'un tap
// court (= laisser passer le tap natif).
const LONG_PRESS_MS = 500;

export function MessageBubble({
  from,
  body,
  correction,
  peerNick,
  onSelect,
  onCorrect,
}: Props) {
  const mine = from === "me";
  const ref = useRef<HTMLParagraphElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = useT();

  const handleSelect = () => {
    if (mine || !onSelect) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    // Garde-fous : pas vide, pas un roman, contenu dans cette bulle.
    if (!text || text.length > 200) return;
    const range = sel.getRangeAt(0);
    if (!ref.current?.contains(range.commonAncestorContainer)) return;
    onSelect(text, range.getBoundingClientRect());
  };

  // Long-press tactile : on attend 500 ms puis on capture le mot sous le
  // doigt via caretRangeFromPoint, on étend aux frontières de mot, et on
  // déclenche le popover comme une sélection normale. Annulé si l'utilisateur
  // bouge ou relâche avant l'échéance.
  const handleTouchStart = (e: React.TouchEvent<HTMLParagraphElement>) => {
    if (mine || !onSelect) return;
    const touch = e.touches[0];
    if (!touch) return;
    const x = touch.clientX;
    const y = touch.clientY;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      const word = wordAtPoint(x, y, ref.current);
      if (word) onSelect(word.text, word.rect);
    }, LONG_PRESS_MS);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // Le bouton ✏️ n'a de sens que pour les messages du peer et tant qu'aucune
  // correction n'a déjà été appliquée (HelloTalk autorise une seule édition).
  const canCorrect = !mine && !correction && !!onCorrect;

  return (
    <div className={cn("flex w-full flex-col gap-1", mine ? "items-end" : "items-start")}>
      <motion.div
        initial={{ opacity: 0, y: 6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className={cn(
          "group flex max-w-[78%] items-end gap-1.5",
          mine ? "flex-row-reverse" : "flex-row",
        )}
      >
        <p
          ref={ref}
          onMouseUp={handleSelect}
          onTouchStart={handleTouchStart}
          onTouchEnd={(e) => {
            cancelLongPress();
            // Si une sélection a malgré tout été faite (geste long sans
            // déclencher le timer), on passe par le chemin normal.
            handleSelect();
            void e;
          }}
          onTouchMove={cancelLongPress}
          onTouchCancel={cancelLongPress}
          className={cn(
            "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug",
            mine
              ? "rounded-br-sm bg-neutral-900 text-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
              : "rounded-bl-sm cursor-text bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100",
          )}
        >
          {body}
        </p>
        {canCorrect && (
          <button
            type="button"
            onClick={onCorrect}
            aria-label={t.correction.correctTooltip}
            title={t.correction.correctTooltip}
            className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <svg
              className="size-4 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        )}
      </motion.div>
      {correction && (
        <CorrectionBubble
          mine={mine}
          correction={correction}
          peerNick={peerNick}
        />
      )}
    </div>
  );
}

// wordAtPoint repère le mot situé sous (x, y) en utilisant l'API caret
// du navigateur. Étend la sélection aux frontières \w côté JS, et renvoie
// le rect de ce mot pour positionner le popover. null si on est sur de
// l'espace ou hors de la bulle.
function wordAtPoint(
  x: number,
  y: number,
  container: HTMLElement | null,
): { text: string; rect: DOMRect } | null {
  if (!container) return null;
  type WithCaret = Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  const doc = document as WithCaret;
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  } else if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  if (!container.contains(node)) return null;
  const text = node.nodeValue ?? "";
  if (!text) return null;
  // Étend [start, end) aux frontières \p{L}\p{N}'-.
  const isWordChar = (c: string) => /[\p{L}\p{N}'’-]/u.test(c);
  let start = Math.min(offset, text.length - 1);
  if (start < 0 || !isWordChar(text[start] ?? "")) return null;
  let end = start;
  while (start > 0 && isWordChar(text[start - 1] ?? "")) start -= 1;
  while (end < text.length && isWordChar(text[end] ?? "")) end += 1;
  const word = text.slice(start, end).trim();
  if (!word) return null;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return { text: word, rect: range.getBoundingClientRect() };
}

interface CorrectionBubbleProps {
  mine: boolean;
  correction: MessageCorrection;
  peerNick: string | null;
}

function CorrectionBubble({ mine, correction, peerNick }: CorrectionBubbleProps) {
  const t = useT();
  // Wording :
  //   - moi correcteur : la bulle apparaît sous un message peer → "Ta correction"
  //   - peer correcteur : la bulle apparaît sous un message moi → "{nick} t'a corrigé"
  const label = correction.fromMe
    ? t.correction.youCorrected
    : t.correction.peerCorrected({
        nick: peerNick ?? t.correction.fallbackCorrector,
      });

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(
        "max-w-[78%] rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px]",
        mine ? "self-end" : "self-start",
      )}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap break-words text-neutral-900 dark:text-neutral-100">
        {correction.corrected}
      </p>
      {correction.note && (
        <p className="mt-1 whitespace-pre-wrap break-words text-[12px] italic text-neutral-600 dark:text-neutral-400">
          « {correction.note} »
        </p>
      )}
    </motion.div>
  );
}
