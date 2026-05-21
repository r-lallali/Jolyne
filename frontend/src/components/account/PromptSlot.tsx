"use client";

import { useEffect, useRef, useState } from "react";
import { PromptDTO } from "@/lib/account";
import { useT } from "@/lib/i18n";
import { PROMPT_KEYS, PromptKey, isPromptKey } from "@/lib/prompts";

// PromptSlot : 1 slot Q&R style Hinge. Carte éditoriale (titre serif +
// réponse en grand) en état rempli, carte CTA dashed en état vide. Le
// chooser est un popover absolu ancré sous la carte.
export function PromptSlot({
  slot,
  taken,
  onChange,
}: {
  slot: PromptDTO;
  taken: string[];
  onChange: (next: PromptDTO) => void;
}) {
  const t = useT();
  const promptKey = isPromptKey(slot.prompt) ? (slot.prompt as PromptKey) : "";
  const [picking, setPicking] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Ferme le popover quand on clique en dehors / sur Escape.
  useEffect(() => {
    if (!picking) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setPicking(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicking(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [picking]);

  const choose = (k: PromptKey) => {
    onChange({ prompt: k, answer: slot.answer });
    setPicking(false);
  };

  // État vide : carte CTA discrète.
  if (!promptKey) {
    return (
      <div ref={rootRef} className="relative">
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          className="flex w-full items-center justify-between rounded-2xl border border-dashed border-neutral-300 bg-transparent px-5 py-4 text-left transition-colors hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:border-neutral-600 dark:hover:bg-neutral-900"
        >
          <span className="font-serif text-base italic text-neutral-500 dark:text-neutral-500">
            {t.account.pickPrompt}
          </span>
          <ChevronIcon open={picking} />
        </button>
        {picking && <PromptPicker taken={taken} onPick={choose} />}
      </div>
    );
  }

  // État rempli : carte éditoriale (titre serif + réponse en grand).
  return (
    <div
      ref={rootRef}
      className="relative rounded-2xl border border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <button
        type="button"
        onClick={() => setPicking((v) => !v)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <span className="font-serif text-base text-neutral-900 dark:text-neutral-50">
          {t.prompts[promptKey]}
        </span>
        <ChevronIcon open={picking} />
      </button>
      <textarea
        value={slot.answer}
        onChange={(e) => onChange({ prompt: promptKey, answer: e.target.value })}
        placeholder={t.account.answerPlaceholder}
        maxLength={200}
        rows={2}
        className="mt-2 w-full resize-none bg-transparent text-lg leading-snug text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-600"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-600">
          {slot.answer.length}/200
        </span>
        <button
          type="button"
          onClick={() => onChange({ prompt: "", answer: "" })}
          className="text-[11px] font-medium text-neutral-400 transition-colors hover:text-red-600 dark:text-neutral-500 dark:hover:text-red-400"
        >
          {t.account.clearPrompt}
        </button>
      </div>
      {picking && <PromptPicker taken={taken} onPick={choose} />}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`mt-1 size-4 shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${
        open ? "rotate-180" : ""
      }`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// PromptPicker : popover absolu sous la carte slot. Liste tous les prompts
// disponibles ; ceux pris par d'autres slots sont grisés et non-cliquables.
function PromptPicker({
  taken,
  onPick,
}: {
  taken: string[];
  onPick: (k: PromptKey) => void;
}) {
  const t = useT();
  return (
    <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
      {PROMPT_KEYS.map((k) => {
        const disabled = taken.includes(k);
        return (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => onPick(k)}
            className={`flex w-full items-center px-5 py-2.5 text-left font-serif text-sm transition-colors ${
              disabled
                ? "cursor-not-allowed text-neutral-300 dark:text-neutral-700"
                : "text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-900"
            }`}
          >
            {t.prompts[k]}
          </button>
        );
      })}
    </div>
  );
}
