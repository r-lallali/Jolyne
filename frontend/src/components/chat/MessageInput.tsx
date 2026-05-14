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
    console.info(
      "[input] submit fired",
      "disabled=",
      disabled,
      "draft=",
      JSON.stringify(draft),
    );
    if (disabled) return;
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft("");
  };

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-2 border-t border-neutral-800 bg-neutral-950 px-3 py-3"
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={disabled}
        maxLength={2000}
        placeholder="Message"
        className="flex-1 rounded-md bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600 disabled:opacity-40"
        autoComplete="off"
      />
      <button
        type="submit"
        disabled={disabled || draft.trim().length === 0}
        className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-30"
      >
        Envoyer
      </button>
    </form>
  );
}
