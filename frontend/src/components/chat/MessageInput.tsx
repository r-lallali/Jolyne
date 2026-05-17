"use client";

import { AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { GrammarPopover } from "@/components/chat/GrammarPopover";
import { checkGrammar, GrammarError, type GrammarMatch } from "@/lib/grammar";
import { useT } from "@/lib/i18n";
import { detectPII } from "@/lib/pii";
import { translateText } from "@/lib/translate";
import { useChatStore } from "@/stores/chatStore";
import { useSessionStore } from "@/stores/sessionStore";

interface Props {
  onSend: (body: string) => void;
  onTyping?: () => void;
  disabled?: boolean;
}

export function MessageInput({ onSend, onTyping, disabled }: Props) {
  const [draft, setDraft] = useState("");
  const [checking, setChecking] = useState(false);
  // matches === null : popover fermé. Tableau vide : "Rien à corriger".
  const [matches, setMatches] = useState<GrammarMatch[] | null>(null);
  const [checkedAgainst, setCheckedAgainst] = useState(""); // texte exact vérifié
  const [grammarErr, setGrammarErr] = useState<string | null>(null);
  // PII : on demande confirmation au 1er submit si pattern détecté. Reset
  // dès que le texte change pour éviter une confirmation périmée.
  const [piiPending, setPiiPending] = useState(false);
  const wants = useSessionStore((s) => s.wants);
  const speaks = useSessionStore((s) => s.speaks);
  const peerNick = useChatStore((s) => s.peerNick);
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus dès qu'on est matché (clé : `peerNick` change à chaque match).
  // Sur mobile, le focus ouvre le clavier — gain de tap réel.
  useEffect(() => {
    if (peerNick) inputRef.current?.focus();
  }, [peerNick]);

  const reallySend = (body: string) => {
    onSend(body);
    setDraft("");
    setMatches(null);
    setGrammarErr(null);
    setPiiPending(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const body = draft.trim();
    if (!body) return;
    if (!piiPending && detectPII(body)) {
      setPiiPending(true);
      return;
    }
    reallySend(body);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value);
    if (onTyping && e.target.value.length > 0) onTyping();
    // Invalide les suggestions et la confirmation PII dès que le texte change.
    if (matches !== null) setMatches(null);
    if (piiPending) setPiiPending(false);
  };

  const runCheck = async () => {
    const text = draft.trim();
    if (!text || !wants || checking) return;
    setChecking(true);
    setGrammarErr(null);
    try {
      const ms = await checkGrammar(text, wants);
      const localized = await localizeMessages(ms, wants, speaks);
      setMatches(localized);
      setCheckedAgainst(text);
    } catch (e) {
      setGrammarErr(
        e instanceof GrammarError
          ? t.grammar.unavailable
          : t.grammar.genericError,
      );
    } finally {
      setChecking(false);
    }
  };

  // Applique un remplacement sur la base du texte exact vérifié, puis
  // retire la suggestion appliquée (les offsets des suivantes sont
  // invalides — on recalcule en cliquant à nouveau sur Corriger).
  const applyReplacement = (matchIndex: number, replacement: string) => {
    if (!matches) return;
    const m = matches[matchIndex];
    if (!m) return;
    const before = checkedAgainst.slice(0, m.offset);
    const after = checkedAgainst.slice(m.offset + m.length);
    const newText = before + replacement + after;
    setDraft(newText);
    setMatches(null);
  };

  const canSend = !disabled && draft.trim().length > 0;
  const canCheck = !disabled && !checking && draft.trim().length > 0 && !!wants;

  return (
    <div className="px-3 pb-3 sm:px-6 sm:pb-6">
      <AnimatePresence>
        {matches !== null && (
          <div className="mx-auto mb-2 w-full max-w-2xl">
            <GrammarPopover
              text={checkedAgainst}
              matches={matches}
              onApply={applyReplacement}
              onClose={() => setMatches(null)}
            />
          </div>
        )}
      </AnimatePresence>

      {grammarErr && (
        <p className="mx-auto mb-1 max-w-2xl text-center text-xs text-red-600 dark:text-red-400">
          {grammarErr}
        </p>
      )}

      {piiPending && (
        <div className="mx-auto mb-2 flex w-full max-w-2xl items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <span className="text-amber-800 dark:text-amber-300">
            {t.chat.piiWarn}
          </span>
          <button
            type="button"
            onClick={() => reallySend(draft.trim())}
            className="shrink-0 rounded-md bg-amber-500/20 px-2 py-1 font-medium text-amber-800 hover:bg-amber-500/30 dark:text-amber-200"
          >
            {t.chat.piiSendAnyway}
          </button>
        </div>
      )}

      <form
        onSubmit={submit}
        className="mx-auto flex w-full max-w-2xl items-center gap-2 rounded-2xl bg-neutral-100 px-4 py-1.5 ring-1 ring-transparent transition-all focus-within:ring-neutral-300 dark:bg-neutral-900 dark:focus-within:ring-neutral-700"
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={handleChange}
          disabled={disabled}
          maxLength={2000}
          placeholder={t.chat.placeholder}
          className="flex-1 bg-transparent py-2.5 text-[15px] text-neutral-900 placeholder:text-neutral-500 focus:outline-none disabled:opacity-40 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={runCheck}
          disabled={!canCheck}
          aria-label={t.chat.grammarLabel}
          title={t.chat.grammarLabel}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-25 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          <svg
            className="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M3 7V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2" />
            <path d="M12 3v18" />
            <path d="M8 21h8" />
          </svg>
        </button>
        <button
          type="submit"
          disabled={!canSend}
          aria-label={t.chat.sendLabel}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-neutral-100 transition-all hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-25 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
        >
          <svg
            className="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>
      </form>
    </div>
  );
}

// LanguageTool renvoie ses messages dans la langue vérifiée (= `wants` côté
// client). Pour les rendre lisibles, on les traduit vers `speaks` via notre
// endpoint /api/translate. Best-effort : si une traduction échoue, on
// retombe sur le message original — pas de blocage UI.
async function localizeMessages(
  matches: GrammarMatch[],
  source: string,
  target: string | null,
): Promise<GrammarMatch[]> {
  if (!target || target === source || matches.length === 0) return matches;
  const translated = await Promise.all(
    matches.map(async (m) => {
      const [msg, short] = await Promise.all([
        m.message ? safeTranslate(m.message, source, target) : null,
        m.short_message ? safeTranslate(m.short_message, source, target) : null,
      ]);
      return {
        ...m,
        message: msg ?? m.message,
        short_message: short ?? m.short_message,
      };
    }),
  );
  return translated;
}

async function safeTranslate(
  text: string,
  source: string,
  target: string,
): Promise<string | null> {
  try {
    return await translateText(text, source, target);
  } catch {
    return null;
  }
}
