"use client";

import { useEffect, useMemo, useState } from "react";
import { Volume2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { completeLesson, type CompleteResult, type PlayItem } from "@/lib/learn";
import { buildScriptExercises, type ScriptExercise } from "@/lib/scriptExercises";
import { speak, speechSupported } from "@/lib/speech";
import { ScriptFooter } from "@/components/learn/ScriptFooter";
import { ScriptIntro } from "@/components/learn/ScriptIntro";
import { SaveWordButton } from "@/components/learn/SaveWordButton";
import { GlyphTrace } from "@/components/learn/GlyphTrace";
import { HangulCompose } from "@/components/learn/HangulCompose";
import { ArabicForms } from "@/components/learn/ArabicForms";
import { LessonResult, SubmitErrorScreen } from "@/components/learn/LessonPlayer";

// Lecteur de leçon d'ÉCRITURE. Réutilise la coquille de gamification du mode
// Cours (cœurs, validation serveur, écran de résultats partagé) mais commence
// par une phase d'introduction des signes, puis enchaîne des exercices dérivés
// par buildScriptExercises (reconnaissance, écoute, composition, formes, tracé).
export function ScriptLessonPlayer({
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
  const exercises = useMemo(() => buildScriptExercises(items), [items]);
  const [phase, setPhase] = useState<"intro" | "play">("intro");
  const [idx, setIdx] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [result, setResult] = useState<CompleteResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ mistakes: number; failed: boolean } | null>(
    null,
  );

  const total = exercises.length;
  const current = exercises[idx];

  useEffect(() => {
    if (total === 0) onClose(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  async function finish(finalMistakes: number, failed: boolean) {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await completeLesson(lessonId, finalMistakes, failed);
      if (failed) {
        onOutOfHearts();
        return;
      }
      setResult(res);
    } catch {
      setSubmitError({ mistakes: finalMistakes, failed });
    } finally {
      setSubmitting(false);
    }
  }

  function handleExerciseDone(exMistakes: number) {
    const nextMistakes = mistakes + exMistakes;
    setMistakes(nextMistakes);
    if (!premium && initialHearts - nextMistakes <= 0) {
      void finish(nextMistakes, true);
      return;
    }
    if (idx + 1 >= total) void finish(nextMistakes, false);
    else setIdx((i) => i + 1);
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
    // Récap : mots de lecture traduits (sens ≠ prononciation) + mots d'exemple
    // des signes — tous audibles et ajoutables au carnet.
    const words = items.flatMap((it) => {
      const out: { term: string; translation: string }[] = [];
      if (it.meaning && it.meaning !== (it.sound ?? "")) {
        out.push({ term: it.target, translation: it.meaning });
      }
      if (it.example && it.example_meaning) {
        out.push({ term: it.example, translation: it.example_meaning });
      }
      return out;
    });
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
    // data-no-swipe : le tracé/glisser ne doit pas déclencher le swipe inter-onglets
    // (listener document de Conversation) qui basculerait vers la liste des conversations.
    <div data-no-swipe className="fixed inset-0 z-[60] flex flex-col bg-white dark:bg-neutral-950">
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
            style={{
              width: `${phase === "intro" ? 0 : total ? (idx / total) * 100 : 0}%`,
            }}
          />
        </div>
        {premium ? (
          <span className="flex items-center gap-1 text-sm font-bold text-amber-500">💛 ∞</span>
        ) : (
          <span className="flex items-center gap-1 text-sm font-bold tabular-nums text-rose-500">
            ❤️ {heartsLeft}
          </span>
        )}
      </div>

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 py-6">
        {phase === "intro" ? (
          <ScriptIntro items={items} targetLang={targetLang} onStart={() => setPhase("play")} />
        ) : submitting || !current ? (
          <div className="flex flex-1 items-center justify-center text-neutral-400">…</div>
        ) : current.kind === "compose" ? (
          <HangulCompose
            key={idx}
            glyph={current.glyph}
            sound={current.sound}
            parts={current.parts}
            tiles={current.tiles}
            onDone={handleExerciseDone}
          />
        ) : current.kind === "forms" ? (
          <ArabicForms
            key={idx}
            glyph={current.glyph}
            sound={current.sound}
            position={current.position}
            answer={current.answer}
            options={current.options}
            onDone={handleExerciseDone}
          />
        ) : current.kind === "trace" ? (
          <GlyphTrace
            key={idx}
            glyph={current.glyph}
            targetLang={targetLang}
            strokes={current.strokes}
            onDone={handleExerciseDone}
          />
        ) : current.kind === "match" ? (
          <ScriptMatch key={idx} ex={current} onDone={handleExerciseDone} />
        ) : (
          <ScriptChoose key={idx} ex={current} targetLang={targetLang} onDone={handleExerciseDone} />
        )}
      </div>
    </div>
  );
}

// ----- QCM signe↔son (reconnaissance / rappel / écoute) -----

function ScriptChoose({
  ex,
  targetLang,
  onDone,
}: {
  ex: Extract<ScriptExercise, { kind: "recognize" | "recall" | "listen" }>;
  targetLang: string;
  onDone: (mistakes: number) => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const answer = ex.kind === "recognize" ? ex.sound : ex.glyph;
  const correct = selected === answer;
  const prompt =
    ex.kind === "recognize"
      ? t.learn.script.recognize
      : ex.kind === "recall"
        ? t.learn.script.recall
        : t.learn.script.listenPrompt;

  // Écoute : on joue le signe à l'arrivée puis sur demande.
  useEffect(() => {
    if (ex.kind === "listen" && speechSupported()) speak(ex.glyph, targetLang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Les options en signe sont grosses (recall / listen) ; en son, normales.
  const bigOptions = ex.kind !== "recognize";

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{prompt}</p>

      <div className="mt-4 flex items-center justify-center gap-3">
        {ex.kind === "recognize" ? (
          <>
            <span className="text-7xl font-bold text-neutral-900 dark:text-neutral-50">
              {ex.glyph}
            </span>
            {speechSupported() && (
              <button
                type="button"
                onClick={() => speak(ex.glyph, targetLang)}
                aria-label={t.learn.listen}
                className="rounded-full bg-sky-100 p-2 text-sky-600 transition-colors hover:bg-sky-200 dark:bg-sky-500/15 dark:text-sky-400"
              >
                <Volume2 className="size-5" aria-hidden />
              </button>
            )}
          </>
        ) : ex.kind === "listen" ? (
          <button
            type="button"
            onClick={() => speak(ex.glyph, targetLang)}
            aria-label={t.learn.listen}
            className="grid size-24 place-items-center rounded-full bg-sky-100 text-sky-600 transition-colors hover:bg-sky-200 dark:bg-sky-500/15 dark:text-sky-400"
          >
            <Volume2 className="size-9" aria-hidden />
          </button>
        ) : (
          <span className="text-4xl font-bold text-sky-600 dark:text-sky-400">{ex.sound}</span>
        )}
      </div>

      <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ex.options.map((opt) => {
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
              className={`rounded-xl border-2 px-3 text-center font-medium text-neutral-900 transition-colors dark:text-neutral-50 ${tone} ${
                bigOptions ? "py-4 text-3xl" : "py-3 text-base"
              }`}
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
        note={ex.meaning}
        extra={
          ex.meaning ? (
            <SaveWordButton term={ex.glyph} translation={ex.meaning} lang={targetLang} />
          ) : undefined
        }
        onCheck={() => setChecked(true)}
        onNext={() => onDone(correct ? 0 : 1)}
      />
    </div>
  );
}

// ----- Association signe ↔ son -----

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

function ScriptMatch({
  ex,
  onDone,
}: {
  ex: Extract<ScriptExercise, { kind: "match" }>;
  onDone: (mistakes: number) => void;
}) {
  const t = useT();
  const left = useMemo(
    () => shuffleIdx(ex.pairs.length).map((i) => ({ id: i, text: ex.pairs[i]!.glyph })),
    [ex],
  );
  const right = useMemo(
    () => shuffleIdx(ex.pairs.length).map((i) => ({ id: i, text: ex.pairs[i]!.sound })),
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
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
        {t.learn.script.matchPrompt}
      </p>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          {left.map((it) => (
            <MatchCell
              key={`l${it.id}`}
              text={it.text}
              big
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
      <ScriptFooter
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
  big,
  matched,
  selected,
  wrong,
  onClick,
}: {
  text: string;
  big?: boolean;
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
      className={`rounded-xl border-2 px-3 font-medium text-neutral-900 transition-colors dark:text-neutral-50 ${tone} ${
        big ? "py-4 text-3xl" : "py-4 text-sm"
      }`}
    >
      {text}
    </button>
  );
}
