"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { getLesson, type PlayItem } from "@/lib/learn";

// Diagnostic « je lis déjà ce script » : court test (signe → son) tiré d'une
// leçon d'écriture représentative. Réussi (≥ 80 %), on propose de sauter tout
// le module d'écriture via le placement existant. Sinon, on encourage à
// commencer par l'écriture (avec saut possible quand même).
const PASS_RATIO = 0.8;
const MAX_Q = 5;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

interface Q {
  glyph: string;
  answer: string;
  options: string[];
}

export function ScriptDiagnostic({
  sampleLessonId,
  from,
  scriptName,
  onPass,
  onClose,
}: {
  sampleLessonId: number;
  from: string;
  scriptName: string;
  onPass: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [items, setItems] = useState<PlayItem[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    getLesson(sampleLessonId, from)
      .then((lp) => setItems(lp.items))
      .catch(() => setItems([]));
  }, [sampleLessonId, from]);

  const questions = useMemo<Q[]>(() => {
    if (!items || items.length === 0) return [];
    const sounds = items.map((it) => it.sound ?? it.meaning);
    return shuffle(items)
      .slice(0, MAX_Q)
      .map((it) => {
        const answer = it.sound ?? it.meaning;
        const distractors = shuffle(sounds.filter((s) => s !== answer)).slice(0, 3);
        return { glyph: it.target, answer, options: shuffle([answer, ...distractors]) };
      });
  }, [items]);

  // Pas de matière exploitable une fois chargé → on referme (effet, jamais
  // pendant le rendu pour ne pas muter le parent en plein render).
  useEffect(() => {
    if (items !== null && questions.length === 0) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  if (items === null || questions.length === 0) {
    return <Shell>…</Shell>;
  }

  const passed = correct / questions.length >= PASS_RATIO;

  if (done) {
    return (
      <Shell>
        <div className="text-5xl">{passed ? "🎉" : "✍️"}</div>
        <h2 className="mt-4 text-xl font-bold text-neutral-900 dark:text-neutral-50">
          {passed ? t.learn.script.diagnosticPass : t.learn.script.diagnosticFail}
        </h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {correct} / {questions.length}
        </p>
        <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
          {passed ? (
            <button
              type="button"
              onClick={onPass}
              className="rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white"
            >
              {t.learn.script.diagnosticCta({ script: scriptName })}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white"
              >
                {t.learn.start}
              </button>
              <button
                type="button"
                onClick={onPass}
                className="rounded-xl py-3 text-sm font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                {t.learn.script.diagnosticSkip}
              </button>
            </>
          )}
        </div>
      </Shell>
    );
  }

  const q = questions[idx]!;

  function answer(opt: string) {
    if (selected) return;
    setSelected(opt);
    const ok = opt === q.answer;
    window.setTimeout(() => {
      if (ok) setCorrect((c) => c + 1);
      if (idx + 1 >= questions.length) setDone(true);
      else setIdx((i) => i + 1);
      setSelected(null);
    }, 450);
  }

  return (
    <Shell>
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">
        {t.learn.script.diagnosticTitle} · {idx + 1}/{questions.length}
      </p>
      <div className="mt-3 text-7xl font-bold text-neutral-900 dark:text-neutral-50">
        {q.glyph}
      </div>
      <div className="mt-8 grid w-full max-w-xs grid-cols-2 gap-2">
        {q.options.map((opt) => {
          const tone = !selected
            ? "border-neutral-200 dark:border-neutral-800"
            : opt === q.answer
              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
              : opt === selected
                ? "border-rose-400 bg-rose-50 dark:bg-rose-500/10"
                : "border-neutral-200 opacity-50 dark:border-neutral-800";
          return (
            <button
              key={opt}
              type="button"
              disabled={!!selected}
              onClick={() => answer(opt)}
              className={`rounded-xl border-2 px-3 py-3 text-sm font-medium text-neutral-900 transition-colors dark:text-neutral-50 ${tone}`}
            >
              {opt}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-6 text-xs font-medium text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
      >
        {t.learn.quit}
      </button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    // data-no-swipe : empêche le swipe inter-onglets pendant le diagnostic.
    <div
      data-no-swipe
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-1 bg-white px-6 text-center dark:bg-neutral-950"
    >
      {children}
    </div>
  );
}
