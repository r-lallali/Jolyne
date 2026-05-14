"use client";

import { useState } from "react";

interface Props {
  onSend: (body: string) => void;
  disabled?: boolean;
}

// Input arrondi Claude/Gemini : fond légèrement teinté, focus ring discret,
// bouton flèche circulaire. Pas de bordure dure.
export function MessageInput({ onSend, disabled }: Props) {
  const [draft, setDraft] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft("");
  };

  const canSend = !disabled && draft.trim().length > 0;

  return (
    <div className="px-3 pb-3 sm:px-6 sm:pb-6">
      <form
        onSubmit={submit}
        className="mx-auto flex w-full max-w-2xl items-center gap-2 rounded-2xl bg-neutral-100 px-4 py-1.5 ring-1 ring-transparent transition-all focus-within:ring-neutral-300 dark:bg-neutral-900 dark:focus-within:ring-neutral-700"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
          maxLength={2000}
          placeholder="Ton message…"
          className="flex-1 bg-transparent py-2.5 text-[15px] text-neutral-900 placeholder:text-neutral-500 focus:outline-none disabled:opacity-40 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          autoComplete="off"
        />
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
