"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";

// Barre de validation / feedback commune aux exercices d'écriture. Reprend le
// comportement de la FooterBar du LessonPlayer (anti double-tap inclus) ; isolée
// ici pour être partagée par les exercices script répartis en plusieurs fichiers.
export function ScriptFooter({
  checked,
  correct,
  canCheck,
  answer,
  note,
  extra,
  onCheck,
  onNext,
}: {
  checked: boolean;
  correct: boolean;
  canCheck: boolean;
  answer?: string;
  // note : information contextuelle affichée au feedback (ex. sens du mot lu).
  note?: string;
  // extra : action contextuelle affichée au feedback (ex. ajout au carnet).
  extra?: React.ReactNode;
  onCheck: () => void;
  onNext: () => void;
}) {
  const t = useT();
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
              (correct
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400")
            }
          >
            {correct ? t.learn.correct : t.learn.incorrect({ answer: answer ?? "" })}
            {note && (
              <span className="ml-1.5 font-normal text-neutral-500 dark:text-neutral-400">
                · {note}
              </span>
            )}
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
