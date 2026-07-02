"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { buildExercises } from "@/lib/learnExercises";
import {
  AssembleExercise,
  ChooseExercise,
  MatchExercise,
} from "@/components/learn/exercises";
import { WordsRecap, type LessonWord } from "@/components/learn/LessonPlayer";

// Lecteur de RÉVISION du carnet de vocabulaire : mêmes exercices que le mode
// Cours, dérivés des entrées du carnet, mais 100 % côté client — pas de vies,
// pas d'XP, pas de validation serveur. Sert d'entraînement libre depuis le
// carnet ou depuis un cours (mots enregistrés dans la langue apprise).
export function PracticePlayer({
  targetLang,
  words,
  onClose,
}: {
  targetLang: string;
  // words : paires (mot cible, sens) issues du carnet — cf. practiceItems.
  words: LessonWord[];
  onClose: () => void;
}) {
  const t = useT();
  const items = useMemo(
    () => words.map((w) => ({ target: w.term, meaning: w.translation })),
    [words],
  );
  const exercises = useMemo(() => buildExercises(items), [items]);
  const [idx, setIdx] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [done, setDone] = useState(false);

  const total = exercises.length;
  const current = exercises[idx];

  // Garde-fou : rien à réviser → on referme plutôt que d'afficher un écran vide.
  useEffect(() => {
    if (total === 0) onClose();
    // onClose est stable pour la durée de vie du lecteur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  function handleExerciseDone(exMistakes: number) {
    setMistakes((m) => m + exMistakes);
    if (idx + 1 >= total) setDone(true);
    else setIdx((i) => i + 1);
  }

  if (done) {
    const accuracy = Math.max(0, Math.round(100 * (1 - mistakes / Math.max(1, total))));
    return (
      <div className="fixed inset-0 z-[60] overflow-y-auto bg-white dark:bg-neutral-950">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center gap-6 px-6 py-[calc(env(safe-area-inset-top)+2.5rem)] text-center">
          <div className="text-6xl">📖</div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
            {t.learn.practiceDone}
          </h1>
          <p className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
            {t.learn.accuracy({ percent: accuracy })}
          </p>
          <WordsRecap words={words} targetLang={targetLang} />
          <button
            type="button"
            onClick={onClose}
            className="mt-2 w-full max-w-xs rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white"
          >
            {t.learn.backToPath}
          </button>
        </div>
      </div>
    );
  }

  return (
    // data-no-swipe : cf. LessonPlayer (exercices à glisser vs swipe d'onglets).
    <div data-no-swipe className="fixed inset-0 z-[60] flex flex-col bg-white dark:bg-neutral-950">
      {/* Barre supérieure : quitter + progression (pas de cœurs en révision). */}
      <div className="flex items-center gap-3 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:pt-4">
        <button
          type="button"
          onClick={onClose}
          aria-label={t.learn.quit}
          className="text-2xl leading-none text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          ✕
        </button>
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className="h-full rounded-full bg-sky-500 transition-all"
            style={{ width: `${total ? (idx / total) * 100 : 0}%` }}
          />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-sky-500">
          {t.vocab.practice}
        </span>
      </div>

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 py-6">
        {!current ? (
          <div className="flex flex-1 items-center justify-center text-neutral-400">…</div>
        ) : current.kind === "choose" ? (
          <ChooseExercise
            key={idx}
            ex={current}
            targetLang={targetLang}
            onDone={handleExerciseDone}
          />
        ) : current.kind === "assemble" ? (
          <AssembleExercise
            key={idx}
            ex={current}
            targetLang={targetLang}
            onDone={handleExerciseDone}
          />
        ) : (
          <MatchExercise key={idx} ex={current} onDone={handleExerciseDone} />
        )}
      </div>
    </div>
  );
}
