"use client";

import { useEffect, useMemo, useState } from "react";
import { Award, Volume2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { completeLesson, type CompleteResult, type PlayItem } from "@/lib/learn";
import { buildExercises } from "@/lib/learnExercises";
import { speak, speechSupported } from "@/lib/speech";
import {
  AssembleExercise,
  ChooseExercise,
  MatchExercise,
} from "@/components/learn/exercises";
import { SaveWordButton } from "@/components/learn/SaveWordButton";

// Lecteur de leçon plein écran. Construit la séquence d'exercices à partir des
// items, suit les fautes (cœurs), puis valide la leçon côté serveur et affiche
// l'écran de résultats (XP, précision, palier de streak, succès débloqués,
// récap des mots pour les ajouter au carnet).
export function LessonPlayer({
  lessonId,
  targetLang,
  title,
  items,
  initialHearts,
  premium,
  onClose,
  onOutOfHearts,
}: {
  lessonId: number;
  targetLang: string;
  title: string;
  items: PlayItem[];
  initialHearts: number;
  premium: boolean;
  onClose: (completed: boolean) => void;
  onOutOfHearts: () => void;
}) {
  const t = useT();
  const exercises = useMemo(() => buildExercises(items), [items]);
  const [idx, setIdx] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [result, setResult] = useState<CompleteResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Échec réseau de la validation : on garde la leçon ouverte avec un bouton
  // « réessayer » plutôt que de tout perdre silencieusement.
  const [submitError, setSubmitError] = useState<{
    mistakes: number;
    failed: boolean;
  } | null>(null);

  const total = exercises.length;
  const current = exercises[idx];

  // Garde-fou : leçon sans exercice exploitable (items vides) → on referme au
  // lieu de rester bloqué sur l'écran de chargement.
  useEffect(() => {
    if (total === 0) onClose(false);
    // onClose est stable pour la durée de vie du lecteur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  async function finish(finalMistakes: number, failed: boolean) {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await completeLesson(lessonId, finalMistakes, failed);
      if (failed) {
        // Plus de cœurs : leçon interrompue, on bascule sur l'écran dédié.
        onOutOfHearts();
        return;
      }
      setResult(res);
    } catch {
      // Échec réseau : on conserve la leçon et on propose de réessayer.
      setSubmitError({ mistakes: finalMistakes, failed });
    } finally {
      setSubmitting(false);
    }
  }

  function handleExerciseDone(exMistakes: number) {
    const nextMistakes = mistakes + exMistakes;
    setMistakes(nextMistakes);
    // Interruption style Duolingo : plus de cœurs en cours de leçon (hors
    // premium = cœurs illimités).
    if (!premium && initialHearts - nextMistakes <= 0) {
      void finish(nextMistakes, true);
      return;
    }
    if (idx + 1 >= total) {
      void finish(nextMistakes, false);
    } else {
      setIdx((i) => i + 1);
    }
  }

  function confirmQuit() {
    if (window.confirm(t.learn.quitConfirm)) onClose(false);
  }

  const heartsLeft = Math.max(0, initialHearts - mistakes);

  if (submitError) {
    return (
      <SubmitErrorScreen
        onRetry={() => void finish(submitError.mistakes, submitError.failed)}
        onQuit={() => onClose(false)}
      />
    );
  }

  if (result) {
    // Récap des mots de la leçon : chaque paire (cible, sens) est audible et
    // ajoutable au carnet depuis l'écran de résultats.
    const words = items
      .filter((it) => it.target && it.meaning)
      .map((it) => ({ term: it.target, translation: it.meaning }));
    return (
      <LessonResult
        title={title}
        result={result}
        words={words}
        targetLang={targetLang}
        onClose={() => onClose(true)}
      />
    );
  }

  return (
    // data-no-swipe : les exercices à glisser (assembler/associer) ne doivent pas
    // déclencher le swipe inter-onglets (listener document de Conversation).
    <div data-no-swipe className="fixed inset-0 z-[60] flex flex-col bg-white dark:bg-neutral-950">
      {/* Barre supérieure : quitter, progression, cœurs */}
      <div className="flex items-center gap-3 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:pt-4">
        <button
          type="button"
          onClick={confirmQuit}
          aria-label={t.learn.quit}
          className="text-2xl leading-none text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          ✕
        </button>
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${total ? (idx / total) * 100 : 0}%` }}
          />
        </div>
        {premium ? (
          <span className="flex items-center gap-1 text-sm font-bold text-amber-500">
            💛 ∞
          </span>
        ) : (
          <span className="flex items-center gap-1 text-sm font-bold tabular-nums text-rose-500">
            ❤️ {heartsLeft}
          </span>
        )}
      </div>

      {/* Corps de l'exercice */}
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 py-6">
        {submitting || !current ? (
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

// ----- Écran d'erreur de validation (retry réseau) -----

export function SubmitErrorScreen({
  onRetry,
  onQuit,
}: {
  onRetry: () => void;
  onQuit: () => void;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-white px-6 text-center dark:bg-neutral-950">
      <div className="text-5xl">📡</div>
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
        {t.errors.genericTitle}
      </h1>
      <p className="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
        {t.errors.genericHint}
      </p>
      <div className="flex w-full max-w-xs flex-col gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white"
        >
          {t.errors.retry}
        </button>
        <button
          type="button"
          onClick={onQuit}
          className="rounded-xl py-3 text-sm font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          {t.learn.quit}
        </button>
      </div>
    </div>
  );
}

// ----- Écran de résultats -----

export interface LessonWord {
  term: string;
  translation: string;
}

export function LessonResult({
  title,
  result,
  words,
  targetLang,
  onClose,
}: {
  title: string;
  result: CompleteResult;
  // words : récap des mots vus (audibles + ajoutables au carnet). Optionnel
  // pour rester rétro-compatible avec les usages sans récap.
  words?: LessonWord[];
  targetLang?: string;
  onClose: () => void;
}) {
  const t = useT();
  // Précision approximée à partir des étoiles (3=100, 2≈80, 1≈60) — on n'a pas
  // le total d'exercices ici, l'étoile reflète déjà la performance.
  const accuracy = result.stars >= 3 ? 100 : result.stars === 2 ? 80 : 60;
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-white dark:bg-neutral-950">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center gap-6 px-6 py-[calc(env(safe-area-inset-top)+2.5rem)] text-center">
        <div className="text-6xl">🎉</div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          {t.learn.lessonComplete}
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{title}</p>

        <div className="flex items-center gap-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={i < result.stars ? "text-3xl text-amber-400" : "text-3xl text-neutral-200 dark:text-neutral-800"}
            >
              ★
            </span>
          ))}
        </div>

        <div className="flex gap-4">
          <Pill label="XP" value={t.learn.xpEarned({ xp: result.xp_awarded })} tone="amber" />
          <Pill label="✓" value={t.learn.accuracy({ percent: accuracy })} tone="emerald" />
        </div>

        {result.new_streak_milestone > 0 && (
          <p className="rounded-full bg-orange-100 px-4 py-2 text-sm font-semibold text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
            🔥 {t.learn.streakMilestone({ count: result.new_streak_milestone })}
          </p>
        )}

        {result.new_achievements.length > 0 && (
          <div className="flex flex-col items-center gap-1">
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              {t.learn.achievementUnlocked}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {result.new_achievements.map((code) => (
                <AchievementChip key={code} code={code} />
              ))}
            </div>
          </div>
        )}

        {words && words.length > 0 && targetLang && (
          <WordsRecap words={words} targetLang={targetLang} />
        )}

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

// WordsRecap : liste sobre des mots de la leçon — écoute + ajout au carnet.
// Partagée avec le lecteur d'écriture (mots de lecture et exemples de signes)
// et la révision du carnet.
export function WordsRecap({
  words,
  targetLang,
}: {
  words: LessonWord[];
  targetLang: string;
}) {
  const t = useT();
  const canSpeak = speechSupported();
  return (
    <div className="w-full text-left">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
        {t.learn.lessonWords}
      </h2>
      <ul className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {words.map((w) => (
          <li key={`${w.term}|${w.translation}`} className="flex items-center gap-2 px-3 py-2">
            {canSpeak && (
              <button
                type="button"
                onClick={() => speak(w.term, targetLang)}
                aria-label={t.learn.listen}
                className="shrink-0 rounded-lg p-1.5 text-sky-500 transition-colors hover:bg-sky-50 dark:hover:bg-sky-500/10"
              >
                <Volume2 className="size-4" aria-hidden />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                {w.term}
              </p>
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                {w.translation}
              </p>
            </div>
            <SaveWordButton compact term={w.term} translation={w.translation} lang={targetLang} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pill({ label, value, tone }: { label: string; value: string; tone: "amber" | "emerald" }) {
  const c =
    tone === "amber"
      ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
      : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300";
  return (
    <div className={`rounded-xl border px-4 py-2 ${c}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}

function AchievementChip({ code }: { code: string }) {
  const t = useT();
  const labels = t.learn.ach as Record<string, string>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
      <Award size={13} strokeWidth={2.5} />
      {labels[code] ?? code}
    </span>
  );
}
