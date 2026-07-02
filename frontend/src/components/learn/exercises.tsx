"use client";

import { useMemo, useState } from "react";
import { Volume2 } from "lucide-react";
import { useT, useUILang } from "@/lib/i18n";
import type { Exercise } from "@/lib/learnExercises";
import { speak, speechSupported } from "@/lib/speech";
import { SaveWordButton } from "@/components/learn/SaveWordButton";
import {
  TranslationPopover,
  type TranslationRequest,
} from "@/components/chat/TranslationPopover";

// Exercices du lecteur de leçon de vocabulaire, partagés entre LessonPlayer
// (leçons de cours) et PracticePlayer (révision du carnet). Chaque exercice
// intègre le carnet (bouton « ajouter » dans le feedback) et la traduction à
// la demande (jetons d'assemblage traduisibles une fois la réponse vérifiée).

// ----- Barre de validation / feedback commune -----

export function FooterBar({
  checked,
  correct,
  canCheck,
  answer,
  extra,
  onCheck,
  onNext,
}: {
  checked: boolean;
  correct: boolean;
  canCheck: boolean;
  answer?: string;
  // extra : action contextuelle affichée avec le feedback (ex. ajout au carnet).
  extra?: React.ReactNode;
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
        <div className="mb-3 flex items-center justify-between gap-2">
          <p
            className={
              "text-sm font-semibold " +
              (correct ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")
            }
          >
            {correct ? t.learn.correct : t.learn.incorrect({ answer: answer ?? "" })}
          </p>
          {extra}
        </div>
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

export function ChooseExercise({
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
  // Sens dans la langue de l'apprenant : la réponse en mode cible→sens, la
  // question en mode sens→cible. Sert à l'ajout au carnet.
  const meaning = ex.mode === "to-meaning" ? ex.answer : ex.question;

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
            <Volume2 className="size-5" aria-hidden />
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
        extra={<SaveWordButton term={ex.target} translation={meaning} lang={targetLang} />}
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

export function AssembleExercise({
  ex,
  targetLang,
  onDone,
}: {
  ex: Extract<Exercise, { kind: "assemble" }>;
  targetLang: string;
  onDone: (mistakes: number) => void;
}) {
  const t = useT();
  const uiLang = useUILang();
  // On suit les jetons par indice (les mots peuvent se répéter).
  const [built, setBuilt] = useState<number[]>([]);
  const [checked, setChecked] = useState(false);
  // Traduction à la demande : une fois vérifié, chaque jeton devient tappable
  // et ouvre le popover de traduction (même mécanique que la sélection en chat).
  const [trans, setTrans] = useState<TranslationRequest | null>(null);
  const used = new Set(built);
  const answer = built.map((i) => ex.tokens[i]).join(" ");
  const correct = norm(answer) === norm(ex.target);
  const canTranslate = checked && uiLang !== targetLang;

  const translateToken = (tok: string, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setTrans({
      text: tok,
      x: rect.left + rect.width / 2,
      y: rect.bottom,
      source: targetLang,
      target: uiLang,
    });
  };

  const tokenClass =
    "rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50";

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
            disabled={checked && !canTranslate}
            onClick={(e) =>
              checked
                ? translateToken(ex.tokens[tokenIdx]!, e.currentTarget)
                : setBuilt((b) => b.filter((_, p) => p !== pos))
            }
            className={tokenClass}
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
              disabled={checked && !canTranslate}
              onClick={(e) =>
                checked
                  ? translateToken(tok, e.currentTarget)
                  : setBuilt((b) => [...b, i])
              }
              className={`${tokenClass} transition-colors hover:bg-neutral-50`}
            >
              {tok}
            </button>
          ),
        )}
      </div>

      {canTranslate && (
        <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
          {t.learn.tapTranslateHint}
        </p>
      )}

      <div className="flex-1" />
      <FooterBar
        checked={checked}
        correct={correct}
        canCheck={built.length > 0}
        answer={ex.target}
        extra={<SaveWordButton term={ex.target} translation={ex.meaning} lang={targetLang} />}
        onCheck={() => setChecked(true)}
        onNext={() => onDone(correct ? 0 : 1)}
      />

      {trans && <TranslationPopover request={trans} onClose={() => setTrans(null)} />}
    </div>
  );
}

// ----- Association de paires -----

export function MatchExercise({
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
