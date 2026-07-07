"use client";

import { useState } from "react";
import { Volume2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { speak, speechSupported } from "@/lib/speech";
import { gradeVocab, type ReviewGrade, type VocabEntry } from "@/lib/vocab";

// Lecteur de RÉVISION ESPACÉE (SRS) : flashcards recto (mot) / verso
// (traduction) avec les 4 notes SM-2. Contrairement au PracticePlayer
// (entraînement libre, 100 % client), chaque note est persistée côté serveur
// et replanifie l'échéance de la carte.
export function ReviewPlayer({
  entries,
  onClose,
}: {
  // entries : pile de cartes dues (ordre serveur = échéance la plus ancienne
  // d'abord). Le côté « mot » est term (langue apprise), le verso translation.
  entries: VocabEntry[];
  onClose: () => void;
}) {
  const t = useT();
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const canSpeak = speechSupported();

  const total = entries.length;
  const current = entries[idx];
  const done = idx >= total;

  async function grade(g: ReviewGrade) {
    if (!current || grading) return;
    setGrading(true);
    try {
      await gradeVocab(current.id, g);
      setReviewed((n) => n + 1);
    } catch {
      // Échec réseau : on passe quand même à la carte suivante — la carte
      // restera due et reviendra à la prochaine session.
    } finally {
      setGrading(false);
      setRevealed(false);
      setIdx((i) => i + 1);
    }
  }

  const gradeButtons: {
    grade: ReviewGrade;
    label: string;
    className: string;
  }[] = [
    {
      grade: "again",
      label: t.vocab.gradeAgain,
      className:
        "bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20",
    },
    {
      grade: "hard",
      label: t.vocab.gradeHard,
      className:
        "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20",
    },
    {
      grade: "good",
      label: t.vocab.gradeGood,
      className:
        "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20",
    },
    {
      grade: "easy",
      label: t.vocab.gradeEasy,
      className:
        "bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20",
    },
  ];

  if (done || !current) {
    return (
      <div className="fixed inset-0 z-[60] overflow-y-auto bg-white dark:bg-neutral-950">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center gap-6 px-6 py-[calc(env(safe-area-inset-top)+2.5rem)] text-center">
          <div className="text-6xl">🧠</div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
            {t.vocab.reviewDone}
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {t.vocab.reviewDoneHint({ count: reviewed })}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 w-full max-w-xs rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-no-swipe className="fixed inset-0 z-[60] flex flex-col bg-white dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 py-[calc(env(safe-area-inset-top)+1.5rem)]">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            className="rounded-lg px-2 py-1 text-sm text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            ✕
          </button>
          <span className="text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
            {idx + 1} / {total}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="mt-8 flex flex-1 cursor-pointer flex-col items-center justify-center gap-4 rounded-3xl border border-neutral-200 bg-neutral-50 p-8 text-center transition-colors dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="flex items-center gap-3">
            <p className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
              {current.term}
            </p>
            {canSpeak && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  speak(current.term, current.source_lang);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    speak(current.term, current.source_lang);
                  }
                }}
                aria-label={t.learn.listen}
                className="rounded-lg p-1.5 text-sky-500 transition-colors hover:bg-sky-50 dark:hover:bg-sky-500/10"
              >
                <Volume2 className="size-5" aria-hidden />
              </span>
            )}
          </div>
          {revealed ? (
            <p className="text-xl text-neutral-600 dark:text-neutral-300">
              {current.translation}
            </p>
          ) : (
            <p className="text-sm text-neutral-400 dark:text-neutral-500">
              {t.vocab.showAnswer}
            </p>
          )}
        </button>

        <div className="mt-6 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {revealed ? (
            <div className="grid grid-cols-4 gap-2">
              {gradeButtons.map((b) => (
                <button
                  key={b.grade}
                  type="button"
                  disabled={grading}
                  onClick={() => grade(b.grade)}
                  className={`rounded-xl py-3 text-xs font-bold transition-colors disabled:opacity-50 ${b.className}`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white"
            >
              {t.vocab.showAnswer}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
