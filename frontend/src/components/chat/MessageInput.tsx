"use client";

import { AnimatePresence } from "framer-motion";
import { useState } from "react";
import { GrammarPopover } from "@/components/chat/GrammarPopover";
import { checkGrammar, GrammarError, type GrammarMatch } from "@/lib/grammar";
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
  const wants = useSessionStore((s) => s.wants);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft("");
    setMatches(null);
    setGrammarErr(null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value);
    if (onTyping && e.target.value.length > 0) onTyping();
    // Invalide les suggestions dès que le texte change.
    if (matches !== null) setMatches(null);
  };

  const runCheck = async () => {
    const text = draft.trim();
    if (!text || !wants || checking) return;
    setChecking(true);
    setGrammarErr(null);
    try {
      const ms = await checkGrammar(text, wants);
      setMatches(ms);
      setCheckedAgainst(text);
    } catch (e) {
      setGrammarErr(
        e instanceof GrammarError ? "Service indisponible" : "Erreur",
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

      <form
        onSubmit={submit}
        className="mx-auto flex w-full max-w-2xl items-center gap-2 rounded-2xl bg-neutral-100 px-4 py-1.5 ring-1 ring-transparent transition-all focus-within:ring-neutral-300 dark:bg-neutral-900 dark:focus-within:ring-neutral-700"
      >
        <input
          value={draft}
          onChange={handleChange}
          disabled={disabled}
          maxLength={2000}
          placeholder="Ton message…"
          className="flex-1 bg-transparent py-2.5 text-[15px] text-neutral-900 placeholder:text-neutral-500 focus:outline-none disabled:opacity-40 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={runCheck}
          disabled={!canCheck}
          aria-label="Vérifier la grammaire"
          title="Vérifier la grammaire"
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
          aria-label="Envoyer"
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
