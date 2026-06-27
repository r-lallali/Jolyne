"use client";

import { useEffect, useMemo, useState } from "react";
import { Award } from "lucide-react";
import { useT } from "@/lib/i18n";
import { completeLesson, type CompleteResult, type PlayItem } from "@/lib/learn";
import { buildExercises, type Exercise } from "@/lib/learnExercises";
import { speak, speechSupported } from "@/lib/speech";

// Lecteur de leçon plein écran. Construit la séquence d'exercices à partir des
// items, suit les fautes (cœurs), puis valide la leçon côté serveur et affiche
// l'écran de résultats (XP, précision, palier de streak, succès débloqués).
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
    return <LessonResult title={title} result={result} onClose={() => onClose(true)} />;
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
          <AssembleExercise key={idx} ex={current} onDone={handleExerciseDone} />
        ) : (
          <MatchExercise key={idx} ex={current} onDone={handleExerciseDone} />
        )}
      </div>
    </div>
  );
}

// ----- Barre de validation / feedback commune -----

function FooterBar({
  checked,
  correct,
  canCheck,
  answer,
  onCheck,
  onNext,
}: {
  checked: boolean;
  correct: boolean;
  canCheck: boolean;
  answer?: string;
  onCheck: () => void;
  onNext: () => void;
}) {
  const t = useT();
  // Anti double-tap : « Continuer » ne doit avancer qu'une fois même en cas de
  // double clic rapide (sinon on saute un exercice / on valide deux fois). Le
  // composant est remonté à chaque exercice (key=idx) → l'état se réinitialise.
  const [advancing, setAdvancing] = useState(false);
  const advance = () => {
    if (advancing) return;
    setAdvancing(true);
    onNext();
  };
  return (
    <div
      className={
        "mt-6 rounded-2xl p-4 transition-colors " +
        (!checked
          ? ""
          : correct
            ? "bg-emerald-50 dark:bg-emerald-500/10"
            : "bg-rose-50 dark:bg-rose-500/10")
      }
    >
      {checked && (
        <p
          className={
            "mb-3 text-sm font-semibold " +
            (correct ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")
          }
        >
          {correct ? t.learn.correct : t.learn.incorrect({ answer: answer ?? "" })}
        </p>
      )}
      {!checked ? (
        <button
          type="button"
          disabled={!canCheck}
          onClick={onCheck}
          className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white transition-opacity disabled:opacity-40"
        >
          {t.learn.check}
        </button>
      ) : (
        <button
          type="button"
          onClick={advance}
          disabled={advancing}
          className={
            "w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-70 " +
            (correct ? "bg-emerald-500" : "bg-rose-500")
          }
        >
          {t.learn.next}
        </button>
      )}
    </div>
  );
}

// ----- QCM -----

function ChooseExercise({
  ex,
  targetLang,
  onDone,
}: {
  ex: Extract<Exercise, { kind: "choose" }>;
  targetLang: string;
  onDone: (mistakes: number) => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const correct = selected === ex.answer;
  const prompt = ex.mode === "to-meaning" ? t.learn.chooseMeaning : t.learn.chooseTarget;
  const showAudio = ex.mode === "to-meaning" && speechSupported();

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{prompt}</p>
      <div className="mt-4 flex items-center gap-3">
        <h2 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">{ex.question}</h2>
        {showAudio && (
          <button
            type="button"
            onClick={() => speak(ex.target, targetLang)}
            aria-label={t.learn.listen}
            className="rounded-full bg-sky-100 p-2 text-sky-600 transition-colors hover:bg-sky-200 dark:bg-sky-500/15 dark:text-sky-400"
          >
            🔊
          </button>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ex.options.map((opt) => {
          const isSel = selected === opt;
          const tone = !checked
            ? isSel
              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
              : "border-neutral-200 dark:border-neutral-800"
            : opt === ex.answer
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
              className={`rounded-xl border-2 px-4 py-3 text-left text-base font-medium text-neutral-900 transition-colors dark:text-neutral-50 ${tone}`}
            >
              {opt}
            </button>
          );
        })}
      </div>

      <div className="flex-1" />
      <FooterBar
        checked={checked}
        correct={correct}
        canCheck={selected !== null}
        answer={ex.answer}
        onCheck={() => setChecked(true)}
        onNext={() => onDone(correct ? 0 : 1)}
      />
    </div>
  );
}

// ----- Assemblage de phrase -----

function norm(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function AssembleExercise({
  ex,
  onDone,
}: {
  ex: Extract<Exercise, { kind: "assemble" }>;
  onDone: (mistakes: number) => void;
}) {
  const t = useT();
  // On suit les jetons par indice (les mots peuvent se répéter).
  const [built, setBuilt] = useState<number[]>([]);
  const [checked, setChecked] = useState(false);
  const used = new Set(built);
  const answer = built.map((i) => ex.tokens[i]).join(" ");
  const correct = norm(answer) === norm(ex.target);

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{t.learn.assemble}</p>
      <h2 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-50">{ex.meaning}</h2>

      {/* Ligne de réponse */}
      <div className="mt-6 flex min-h-[3.5rem] flex-wrap content-start gap-2 border-b-2 border-dashed border-neutral-200 pb-3 dark:border-neutral-800">
        {built.map((tokenIdx, pos) => (
          <button
            key={`${tokenIdx}-${pos}`}
            type="button"
            disabled={checked}
            onClick={() => setBuilt((b) => b.filter((_, p) => p !== pos))}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
          >
            {ex.tokens[tokenIdx]}
          </button>
        ))}
      </div>

      {/* Banque de mots */}
      <div className="mt-5 flex flex-wrap gap-2">
        {ex.tokens.map((tok, i) =>
          used.has(i) ? (
            <span
              key={i}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-transparent dark:border-neutral-800"
            >
              {tok}
            </span>
          ) : (
            <button
              key={i}
              type="button"
              disabled={checked}
              onClick={() => setBuilt((b) => [...b, i])}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
            >
              {tok}
            </button>
          ),
        )}
      </div>

      <div className="flex-1" />
      <FooterBar
        checked={checked}
        correct={correct}
        canCheck={built.length > 0}
        answer={ex.target}
        onCheck={() => setChecked(true)}
        onNext={() => onDone(correct ? 0 : 1)}
      />
    </div>
  );
}

// ----- Association de paires -----

function MatchExercise({
  ex,
  onDone,
}: {
  ex: Extract<Exercise, { kind: "match" }>;
  onDone: (mistakes: number) => void;
}) {
  const t = useT();
  // Colonnes mélangées indépendamment, reliées par l'indice de paire.
  const left = useMemo(
    () => shuffleIdx(ex.pairs.length).map((i) => ({ id: i, text: ex.pairs[i]!.target })),
    [ex],
  );
  const right = useMemo(
    () => shuffleIdx(ex.pairs.length).map((i) => ({ id: i, text: ex.pairs[i]!.meaning })),
    [ex],
  );
  const [selLeft, setSelLeft] = useState<number | null>(null);
  const [selRight, setSelRight] = useState<number | null>(null);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [mistakes, setMistakes] = useState(0);
  const [wrong, setWrong] = useState(false);

  function tryMatch(l: number | null, r: number | null) {
    if (l === null || r === null) return;
    if (l === r) {
      const next = new Set(matched);
      next.add(l);
      setMatched(next);
      setSelLeft(null);
      setSelRight(null);
    } else {
      setMistakes((m) => m + 1);
      setWrong(true);
      window.setTimeout(() => {
        setWrong(false);
        setSelLeft(null);
        setSelRight(null);
      }, 500);
    }
  }

  const done = matched.size === ex.pairs.length;

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{t.learn.matchPairs}</p>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          {left.map((it) => (
            <MatchCell
              key={`l${it.id}`}
              text={it.text}
              matched={matched.has(it.id)}
              selected={selLeft === it.id}
              wrong={wrong && selLeft === it.id}
              onClick={() => {
                if (matched.has(it.id)) return;
                setSelLeft(it.id);
                tryMatch(it.id, selRight);
              }}
            />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {right.map((it) => (
            <MatchCell
              key={`r${it.id}`}
              text={it.text}
              matched={matched.has(it.id)}
              selected={selRight === it.id}
              wrong={wrong && selRight === it.id}
              onClick={() => {
                if (matched.has(it.id)) return;
                setSelRight(it.id);
                tryMatch(selLeft, it.id);
              }}
            />
          ))}
        </div>
      </div>

      <div className="flex-1" />
      <FooterBar
        checked={done}
        correct={mistakes === 0}
        canCheck={false}
        onCheck={() => {}}
        onNext={() => onDone(mistakes)}
      />
    </div>
  );
}

function MatchCell({
  text,
  matched,
  selected,
  wrong,
  onClick,
}: {
  text: string;
  matched: boolean;
  selected: boolean;
  wrong: boolean;
  onClick: () => void;
}) {
  const tone = matched
    ? "border-emerald-300 bg-emerald-50 text-emerald-400 dark:border-emerald-500/30 dark:bg-emerald-500/10"
    : wrong
      ? "border-rose-400 bg-rose-50 dark:bg-rose-500/10"
      : selected
        ? "border-sky-500 bg-sky-50 dark:bg-sky-500/10"
        : "border-neutral-200 dark:border-neutral-800";
  return (
    <button
      type="button"
      disabled={matched}
      onClick={onClick}
      className={`rounded-xl border-2 px-3 py-3 text-sm font-medium text-neutral-900 transition-colors dark:text-neutral-50 ${tone}`}
    >
      {text}
    </button>
  );
}

function shuffleIdx(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
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

export function LessonResult({
  title,
  result,
  onClose,
}: {
  title: string;
  result: CompleteResult;
  onClose: () => void;
}) {
  const t = useT();
  // Précision approximée à partir des étoiles (3=100, 2≈80, 1≈60) — on n'a pas
  // le total d'exercices ici, l'étoile reflète déjà la performance.
  const accuracy = result.stars >= 3 ? 100 : result.stars === 2 ? 80 : 60;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-white px-6 text-center dark:bg-neutral-950">
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

      <button
        type="button"
        onClick={onClose}
        className="mt-2 w-full max-w-xs rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white"
      >
        {t.learn.backToPath}
      </button>
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
