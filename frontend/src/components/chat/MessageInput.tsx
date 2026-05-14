"use client";

import { useState } from "react";

interface Props {
  onSend: (body: string) => void;
  disabled?: boolean;
}

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
    <form
      onSubmit={submit}
      className="flex items-center gap-2 border-t border-neutral-900/70 bg-neutral-950/60 px-3 py-3 backdrop-blur"
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={disabled}
        maxLength={2000}
        placeholder="Ton message…"
        className="flex-1 rounded-lg bg-neutral-900/70 px-3.5 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 transition-colors focus:bg-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-700 disabled:opacity-40"
        autoComplete="off"
      />
      <button
        type="submit"
        disabled={!canSend}
        className="rounded-lg bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-950 transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-25"
      >
        Envoyer
      </button>
    </form>
  );
}
