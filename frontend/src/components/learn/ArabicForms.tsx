"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import { ScriptFooter } from "@/components/learn/ScriptFooter";

// Exercice des FORMES POSITIONNELLES (arabe) : une même lettre change de forme
// selon sa position dans le mot (initiale / médiane / finale). On montre la
// lettre isolée + son nom, et on demande sa forme à une position donnée. C'est
// le point dur de la lecture arabe — d'où un exercice dédié.
export function ArabicForms({
  glyph,
  sound,
  position,
  answer,
  options,
  onDone,
}: {
  glyph: string;
  sound: string;
  position: number; // 1 initiale, 2 médiane, 3 finale
  answer: string;
  options: string[];
  onDone: (mistakes: number) => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const correct = selected === answer;

  const posLabel =
    position === 1
      ? t.learn.script.formInitial
      : position === 2
        ? t.learn.script.formMedial
        : t.learn.script.formFinal;

  return (
    <div className="flex flex-1 flex-col" dir="rtl">
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400" dir="ltr">
        {t.learn.script.formsPrompt({ position: posLabel })}
      </p>
      <div className="mt-4 flex items-baseline justify-center gap-3">
        <span className="text-6xl font-bold text-neutral-900 dark:text-neutral-50">
          {glyph}
        </span>
        <span className="text-base font-medium text-sky-600 dark:text-sky-400" dir="ltr">
          {sound}
        </span>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3">
        {options.map((opt) => {
          const isSel = selected === opt;
          const tone = !checked
            ? isSel
              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
              : "border-neutral-200 dark:border-neutral-800"
            : opt === answer
              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
              : isSel
                ? "border-rose-400 bg-rose-50 dark:bg-rose-500/10"
                : "border-neutral-200 opacity-50 dark:border-neutral-800";
          return (
            <button
              key={opt}
              type="button"
              disabled={checked}
              onClick={() => setSelected(opt)}
              className={`rounded-xl border-2 px-4 py-5 text-4xl font-medium text-neutral-900 transition-colors dark:text-neutral-50 ${tone}`}
            >
              {opt}
            </button>
          );
        })}
      </div>

      <div className="flex-1" />
      <ScriptFooter
        checked={checked}
        correct={correct}
        canCheck={selected !== null}
        answer={answer}
        onCheck={() => setChecked(true)}
        onNext={() => onDone(correct ? 0 : 1)}
      />
    </div>
  );
}
