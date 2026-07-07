"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import {
  completeDailyLesson,
  type CompleteResult,
  type DailyReviewItem,
} from "@/lib/learn";

// Lecteur de la « LEÇON DU JOUR » : rejoue les fautes corrigées extraites des
// conversations de l'apprenant (analyse IA de fin de chat). Un exercice par
// faute : choisir la forme correcte entre ce qu'il avait écrit et la
// correction, puis lire l'explication. Pas de cœurs (aucun enjeu d'échec) —
// l'XP et le streak sont crédités à la complétion via l'API.
export function DailyLessonPlayer({
  items,
  onClose,
}: {
  items: DailyReviewItem[];
  // completed=true si la leçon a été validée côté serveur (rafraîchir l'état).
  onClose: (completed: boolean) => void;
}) {
  const t = useT();
  const [idx, setIdx] = useState(0);
  // null = pas encore répondu ; sinon l'option choisie.
  const [picked, setPicked] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [result, setResult] = useState<CompleteResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const total = items.length;
  const current = items[idx];
  const done = idx >= total;

  // Ordre des deux options figé par exercice (pas de re-mélange au re-render).
  const options = useMemo(() => {
    if (!current) return [];
    const pair = [current.corrected, current.original];
    return Math.random() < 0.5 ? pair : [...pair].reverse();
    // Un seul mélange par item courant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const pick = (option: string) => {
    if (picked !== null || !current) return;
    setPicked(option);
    if (option !== current.corrected) setMistakes((m) => m + 1);
  };

  const next = () => {
    setPicked(null);
    setIdx((i) => i + 1);
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await completeDailyLesson(items.map((it) => it.id));
      setResult(res);
    } catch {
      // Échec réseau/conflit : on referme sans XP — les items restent
      // consommables et la leçon reviendra.
      onClose(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (done || !current) {
    return (
      <div className="fixed inset-0 z-[60] overflow-y-auto bg-white dark:bg-neutral-950">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center gap-6 px-6 py-[calc(env(safe-area-inset-top)+2.5rem)] text-center">
          <div className="text-6xl">✍️</div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
            {t.learn.daily.doneTitle}
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {t.learn.daily.doneHint({ total, mistakes })}
          </p>
          {result ? (
            <>
              <p className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                +{result.xp_awarded} XP
              </p>
              <button
                type="button"
                onClick={() => onClose(true)}
                className="mt-2 w-full max-w-xs rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white"
              >
                {t.learn.backToPath}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={submit}
              className="mt-2 w-full max-w-xs rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {t.learn.daily.claim}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-no-swipe className="fixed inset-0 z-[60] flex flex-col bg-white dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 py-[calc(env(safe-area-inset-top)+1.5rem)]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onClose(false)}
            aria-label={t.common.close}
            className="rounded-lg px-2 py-1 text-sm text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            ✕
          </button>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${(100 * idx) / total}%` }}
            />
          </div>
        </div>

        <p className="mt-8 text-sm font-semibold text-neutral-500 dark:text-neutral-400">
          {t.learn.daily.question}
        </p>

        <div className="mt-4 space-y-3">
          {options.map((option) => {
            const isCorrect = option === current.corrected;
            const revealed = picked !== null;
            const state = !revealed
              ? "border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
              : isCorrect
                ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500/50 dark:bg-emerald-500/10"
                : option === picked
                  ? "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10"
                  : "border-neutral-200 bg-white opacity-60 dark:border-neutral-800 dark:bg-neutral-900";
            return (
              <button
                key={option}
                type="button"
                disabled={picked !== null}
                onClick={() => pick(option)}
                className={`w-full rounded-2xl border px-4 py-3.5 text-left text-sm font-medium text-neutral-900 transition-colors dark:text-neutral-50 ${state}`}
              >
                {option}
              </button>
            );
          })}
        </div>

        {picked !== null && current.note && (
          <p className="mt-5 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:bg-sky-500/10 dark:text-sky-300">
            💡 {current.note}
          </p>
        )}

        <div className="mt-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {picked !== null && (
            <button
              type="button"
              onClick={next}
              className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white"
            >
              {t.learn.daily.next}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
