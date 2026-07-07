"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { MessageCorrection } from "@/stores/chatStore";

interface Props {
  from: "me" | "peer";
  body: string;
  at: number;
  correction?: MessageCorrection;
  peerNick: string | null;
  // Appelé quand l'utilisateur sélectionne du texte dans une bulle peer.
  // Permet à la liste d'ancrer un tooltip de traduction.
  onSelect?: (text: string, rect: DOMRect) => void;
  // Demande l'ouverture du modal de correction sur ce message (bulles peer
  // uniquement, et seulement si aucune correction n'a déjà été envoyée).
  onCorrect?: () => void;
  // Demande l'édition d'une correction qu'on a déjà envoyée (uniquement si
  // dans la fenêtre d'édition — la décision se fait dans le parent).
  onEditCorrection?: () => void;
  // Si présent, affiche une petite flèche à côté des bulles peer qui
  // traduit la phrase entière. Réutilise le même handler que `onSelect`
  // côté parent — c'est `onSelect` qui ancre la TranslationPopover.
  //
  // Édition / suppression (chat ami uniquement, sur mes propres bulles) :
  // editedAt / deletedAt = timestamps reçus du serveur ; onEditMessage =
  // sauvegarde du nouveau body ; onDeleteMessage = soft-delete.
  editedAt?: number;
  deletedAt?: number;
  onEditMessage?: (body: string) => void;
  onDeleteMessage?: () => void;
  // Mode sélection (chat ami) : si actif, le tap toggle la sélection au
  // lieu d'ouvrir une action. `selected` reflète l'état courant. Long-
  // press déclenche `onEnterSelection` côté parent.
  selectionMode?: boolean;
  selected?: boolean;
  onEnterSelection?: () => void;
  onToggleSelected?: () => void;
  // Mode immersion : traduction automatique affichée sous le corps du
  // message (bulles peer uniquement, fournie par useAutoTranslations).
  translation?: string;
}

// Bulles asymétriques :
//   - moi  : alignées à droite, fond inversé (sombre en light, clair en dark)
//   - peer : alignées à gauche, fond doux (gris clair en light, gris foncé en dark)
//
// Quand une correction existe, elle s'affiche en sous-bulle juste sous le
// message original — même alignement que la bulle parente.
// Fenêtre pendant laquelle le correcteur peut éditer sa correction.
const EDIT_WINDOW_MS = 30_000;
// Fenêtre pendant laquelle on peut MODIFIER un message ami (5 min,
// alignée sur la constante serveur `friends.EditWindow`). Au-delà,
// l'icône "Modifier" disparaît côté UI ; le serveur rejette de toute
// façon une tentative tardive.
const FRIEND_EDIT_WINDOW_MS = 5 * 60 * 1000;

export function MessageBubble({
  from,
  body,
  at,
  correction,
  peerNick,
  onSelect,
  onCorrect,
  onEditCorrection,
  editedAt,
  deletedAt,
  onEditMessage,
  onDeleteMessage,
  selectionMode = false,
  selected = false,
  onEnterSelection,
  onToggleSelected,
  translation,
}: Props) {
  const mine = from === "me";
  const ref = useRef<HTMLParagraphElement>(null);
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Ferme le menu au clic extérieur.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-bubble-menu]")) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const isDeleted = !!deletedAt;
  const isEdited = !isDeleted && !!editedAt;
  const canEditNow =
    mine && !isDeleted && !!onEditMessage && Date.now() - at < FRIEND_EDIT_WINDOW_MS;
  const canDeleteNow = mine && !isDeleted && !!onDeleteMessage;
  const hasMenu = canEditNow || canDeleteNow;

  // Long-press sur mes bulles : entre en mode sélection (multi-suppression).
  // Implémenté en JS pur — pas de geste lib pour rester léger.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const beginLongPress = () => {
    if (!mine || !onEnterSelection || selectionMode || isDeleted) return;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      onEnterSelection();
    }, 500);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // Click/tap simple sur une bulle peer : on identifie le mot sous le
  // pointeur via caretRangeFromPoint, on étend aux frontières de mot, et
  // on ouvre le tooltip de traduction. Si l'utilisateur a fait une vraie
  // sélection multi-mots (drag desktop), on la respecte à la place.
  // En mode sélection : tap = toggle sur mes bulles uniquement.
  const handleClick = (e: React.MouseEvent<HTMLParagraphElement>) => {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (selectionMode) {
      if (mine && !isDeleted) onToggleSelected?.();
      return;
    }
    if (mine || !onSelect) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      const text = sel.toString().trim();
      if (text && text.length <= 200) {
        const range = sel.getRangeAt(0);
        if (ref.current?.contains(range.commonAncestorContainer)) {
          onSelect(text, range.getBoundingClientRect());
          return;
        }
      }
    }
    const word = wordAtPoint(e.clientX, e.clientY, ref.current);
    if (word) onSelect(word.text, word.rect);
  };

  // Le bouton ✏️ n'a de sens que pour les messages du peer et tant qu'aucune
  // correction n'a déjà été appliquée (HelloTalk autorise une seule édition).
  const canCorrect = !mine && !correction && !!onCorrect;

  // Pastille « hh:mm » affichée à côté de chaque bulle. Sur desktop elle
  // est toujours visible. Sur mobile elle est légèrement décalée vers la
  // droite et invisible par défaut — la classe `peer-times-revealed` sur
  // un ancêtre (toggle via swipe gauche, voir MessageList) la fait
  // glisser à sa place finale.
  const timeLabel = new Date(at).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-1",
        mine ? "items-end" : "items-start",
      )}
      onPointerDown={beginLongPress}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onPointerLeave={cancelLongPress}
    >
      <motion.div
        initial={{ opacity: 0, y: 6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className={cn(
          "group flex max-w-[78%] items-end gap-1.5",
          mine ? "flex-row-reverse" : "flex-row",
          // Halo discret quand la bulle est sélectionnée pour suppression
          // groupée. Garde l'animation entry de la bulle.
          selected && mine && "rounded-2xl ring-2 ring-red-500/40",
        )}
      >
        {editing ? (
          <BubbleEditor
            initial={body}
            draft={draft}
            setDraft={setDraft}
            onSave={() => {
              const next = draft.trim();
              if (next && next !== body) onEditMessage?.(next);
              setEditing(false);
            }}
            onCancel={() => {
              setDraft(body);
              setEditing(false);
            }}
          />
        ) : (
          <p
            ref={ref}
            title={new Date(at).toLocaleTimeString()}
            onClick={isDeleted ? undefined : handleClick}
            className={cn(
              "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug",
              isDeleted
                ? mine
                  ? "rounded-br-sm bg-neutral-200 italic text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500"
                  : "rounded-bl-sm bg-neutral-100 italic text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500"
                : mine
                  ? "rounded-br-sm bg-neutral-900 text-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
                  : "rounded-bl-sm cursor-text bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100",
            )}
          >
            {isDeleted ? t.chats.deletedPlaceholder : body}
            {isEdited && (
              <span
                className={cn(
                  "ml-2 inline-block align-baseline text-[10px] italic",
                  mine
                    ? "text-neutral-400 dark:text-neutral-500"
                    : "text-neutral-500 dark:text-neutral-500",
                )}
              >
                · {t.chats.editedSuffix}
              </span>
            )}
            {!isDeleted && !mine && translation && (
              // Mode immersion : la traduction vit dans la bulle, séparée
              // par un filet. stopPropagation : un tap sur la traduction ne
              // doit pas déclencher le tap-to-translate du texte original.
              <span
                onClick={(e) => e.stopPropagation()}
                className="mt-1.5 block cursor-default border-t border-neutral-300/60 pt-1.5 text-[13px] italic leading-snug text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
              >
                {translation}
              </span>
            )}
          </p>
        )}
        {hasMenu && !editing && (
          <div data-bubble-menu className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={t.chats.menuLabel}
              title={t.chats.menuLabel}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-neutral-500 opacity-0 transition-all hover:bg-neutral-100 hover:text-neutral-900 active:scale-90 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              <DotsIcon />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className={cn(
                  "absolute z-30 mt-1 w-44 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-950",
                  mine ? "right-0" : "left-0",
                )}
              >
                {canEditNow && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setDraft(body);
                      setEditing(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
                  >
                    {t.chats.editMessage}
                  </button>
                )}
                {canDeleteNow && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmDelete(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                  >
                    {t.chats.deleteMessage}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {!mine && onSelect && (
          // Flèche "tout traduire" : déclenche le même handler onSelect
          // que le tap-mot, mais en passant le body entier. Visible sur
          // tactile (pas de hover) — discrète sur desktop.
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const rect = ref.current?.getBoundingClientRect();
              if (!rect) return;
              onSelect(body, rect);
            }}
            aria-label={t.translate.label}
            title={t.translate.label}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-neutral-100 hover:text-neutral-900 active:scale-90 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            <TranslateArrow />
          </button>
        )}
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
        <span
          aria-hidden
          data-time-pill
          // Mobile : caché par défaut (opacité 0). Un ancêtre avec
          // `data-times-revealed="on"` (toggle par swipe gauche dans la
          // liste) la rend visible. Desktop : visible au hover uniquement.
          className="shrink-0 select-none whitespace-nowrap text-[10px] tabular-nums leading-none text-neutral-400 opacity-0 transition-opacity duration-200 group-data-[times-revealed=on]/list:opacity-100 dark:text-neutral-500 sm:group-hover:opacity-100"
        >
          {timeLabel}
        </span>
      </motion.div>
      {correction && (
        <CorrectionBubble
          mine={mine}
          correction={correction}
          peerNick={peerNick}
          onEdit={onEditCorrection}
        />
      )}
      {confirmDelete && (
        <DeleteMessageModal
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            onDeleteMessage?.();
          }}
        />
      )}
    </div>
  );
}

// BubbleEditor : remplace la bulle texte par un éditeur inline. Limite
// 2000 chars (alignée sur MessageMaxLen serveur). Enter = save, Esc =
// cancel. Le visuel garde l'aplat sombre / aplat clair de la bulle owner
// pour ne pas casser l'orientation.
function BubbleEditor({
  initial,
  draft,
  setDraft,
  onSave,
  onCancel,
}: {
  initial: string;
  draft: string;
  setDraft: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    // place le curseur en fin de texte
    if (inputRef.current) {
      const end = inputRef.current.value.length;
      inputRef.current.setSelectionRange(end, end);
    }
  }, []);
  const trimmed = draft.trim();
  const canSave = trimmed.length > 0 && trimmed !== initial;
  return (
    <div className="flex max-w-[78%] flex-col gap-1.5">
      <textarea
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, 2000))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canSave) onSave();
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        rows={Math.min(6, Math.max(1, draft.split("\n").length))}
        className="resize-none rounded-2xl rounded-br-sm bg-neutral-900 px-3.5 py-2 text-[15px] leading-snug text-neutral-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:bg-neutral-50 dark:text-neutral-900"
      />
      <div className="flex justify-end gap-1.5 text-[11px]">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full bg-neutral-100 px-3 py-1 font-medium text-neutral-600 transition-colors hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {t.chats.cancelEdit}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="rounded-full bg-emerald-500/15 px-3 py-1 font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-30 dark:text-emerald-400"
        >
          {t.chats.saveEdit}
        </button>
      </div>
    </div>
  );
}

// DotsIcon : trois points horizontaux pour le bouton menu d'une bulle.
function DotsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
      aria-hidden
    >
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </svg>
  );
}

// DeleteMessageModal : confirmation centrée, alignée sur le style des
// autres confirms du produit (RemoveConfirmModal côté friends).
function DeleteMessageModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-3xl bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-xl dark:bg-neutral-950 sm:rounded-3xl sm:pb-6"
      >
        <p className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
          {t.chats.deleteMessage}
        </p>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {t.chats.deleteMessageConfirm}
        </p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            {t.chats.deleteMessage}
          </button>
        </div>
      </div>
    </div>
  );
}

// TranslateArrow : petite icône globe + flèche pour le bouton
// "traduire toute la phrase". Discret, taillé pour 24x24 carré.
function TranslateArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
      aria-hidden
    >
      <path d="M5 8h7" />
      <path d="M9 4v1" />
      <path d="M5 12c0 2 2 4 5 4" />
      <path d="M13 19l3-7 3 7" />
      <path d="M14 17h4" />
    </svg>
  );
}

// wordAtPoint repère le mot situé sous (x, y) en utilisant l'API caret
// du navigateur. Découpe via Intl.Segmenter quand dispo — indispensable
// pour les langues sans espaces (chinois, japonais) où l'expansion regex
// avalerait la phrase entière — sinon étend aux frontières \w. Renvoie
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
  const idx = Math.min(offset, text.length - 1);
  if (idx < 0) return null;
  let start = -1;
  let end = -1;
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    // Segmentation par dictionnaire ICU, locale-agnostique : trouve le
    // segment « mot » contenant le caret. isWordLike=false = ponctuation
    // ou espace → pas de traduction.
    const seg = new Intl.Segmenter(undefined, { granularity: "word" });
    for (const s of seg.segment(text)) {
      if (idx >= s.index && idx < s.index + s.segment.length) {
        if (!s.isWordLike) return null;
        start = s.index;
        end = s.index + s.segment.length;
        break;
      }
    }
  } else {
    // Fallback vieux navigateurs : étend [start, end) aux frontières
    // \p{L}\p{N}'- (ne segmente pas le CJK, mieux que rien).
    const isWordChar = (c: string) => /[\p{L}\p{N}'’-]/u.test(c);
    if (!isWordChar(text[idx] ?? "")) return null;
    start = idx;
    end = idx;
    while (start > 0 && isWordChar(text[start - 1] ?? "")) start -= 1;
    while (end < text.length && isWordChar(text[end] ?? "")) end += 1;
  }
  if (start < 0 || end <= start) return null;
  const word = text.slice(start, end).trim();
  if (!word) return null;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return { text: word, rect: range.getBoundingClientRect() };
}

// diffTokens : word-level LCS entre `original` et `corrected`. Renvoie les
// tokens de `corrected` annotés `changed=true` pour ceux qui n'apparaissent
// pas dans le LCS — i.e. ajoutés/remplacés par le correcteur. Suffisant pour
// surligner visuellement la diff dans une bulle, pas un vrai outil de diff.
interface Token {
  text: string;
  changed: boolean;
}
function diffTokens(a: string, b: string): Token[] {
  const split = (s: string) => s.split(/(\s+)/);
  const aTok = split(a);
  const bTok = split(b);
  const n = aTok.length;
  const m = bTok.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] =
        aTok[i] === bTok[j]
          ? (dp[i + 1]![j + 1] ?? 0) + 1
          : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
    }
  }
  const out: Token[] = [];
  let i = 0;
  let j = 0;
  while (j < m) {
    const bt = bTok[j] ?? "";
    if (i < n && aTok[i] === bt) {
      out.push({ text: bt, changed: false });
      i += 1;
      j += 1;
    } else if (i < n && (dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      i += 1;
    } else {
      out.push({ text: bt, changed: bt.trim().length > 0 });
      j += 1;
    }
  }
  return out;
}

interface CorrectionBubbleProps {
  mine: boolean;
  correction: MessageCorrection;
  peerNick: string | null;
  onEdit?: () => void;
}

function CorrectionBubble({
  mine,
  correction,
  peerNick,
  onEdit,
}: CorrectionBubbleProps) {
  const t = useT();
  // Le lien d'édition disparaît au bout de EDIT_WINDOW_MS. On planifie un
  // unique setTimeout pour forcer la re-render à l'échéance.
  const [editExpired, setEditExpired] = useState(
    () => Date.now() - correction.at >= EDIT_WINDOW_MS,
  );
  useEffect(() => {
    if (!onEdit || editExpired) return;
    const remaining = EDIT_WINDOW_MS - (Date.now() - correction.at);
    if (remaining <= 0) {
      setEditExpired(true);
      return;
    }
    const id = setTimeout(() => setEditExpired(true), remaining);
    return () => clearTimeout(id);
  }, [onEdit, correction.at, editExpired]);
  const canEdit = onEdit && !editExpired;
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
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
          {label}
        </p>
        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="text-[11px] font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
          >
            {t.correction.editLink}
          </button>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-neutral-900 dark:text-neutral-100">
        {diffTokens(correction.original, correction.corrected).map((tok, i) =>
          tok.changed ? (
            <span
              key={i}
              className="rounded bg-amber-500/20 px-0.5 underline decoration-amber-600 decoration-2 underline-offset-2 dark:decoration-amber-400"
            >
              {tok.text}
            </span>
          ) : (
            <span key={i}>{tok.text}</span>
          ),
        )}
      </p>
      {correction.note && (
        <p className="mt-1 whitespace-pre-wrap break-words text-[12px] italic text-neutral-600 dark:text-neutral-400">
          « {correction.note} »
        </p>
      )}
    </motion.div>
  );
}
