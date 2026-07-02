"use client";

import { Volume2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { PlayItem } from "@/lib/learn";
import { speak, speechSupported } from "@/lib/speech";

// Présentation des nouveaux signes d'une leçon d'écriture, avant le quiz : une
// grille signe + prononciation, chaque carte audible (TTS). « On voit avant de
// reconnaître » — on n'interroge jamais un signe qui n'a pas été montré.
export function ScriptIntro({
  items,
  targetLang,
  onStart,
}: {
  items: PlayItem[];
  targetLang: string;
  onStart: () => void;
}) {
  const t = useT();
  const canSpeak = speechSupported();
  return (
    <div className="flex flex-1 flex-col">
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
        {t.learn.script.newSign}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((it) => (
          <button
            key={it.target}
            type="button"
            onClick={() => canSpeak && speak(it.target, targetLang)}
            className="flex flex-col items-center gap-1 rounded-2xl border border-neutral-200 bg-white px-3 py-5 transition-colors hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/70 dark:hover:border-neutral-700"
          >
            <span className="text-5xl font-bold text-neutral-900 dark:text-neutral-50">
              {it.target}
            </span>
            <span className="mt-1 text-sm font-medium text-sky-600 dark:text-sky-400">
              {it.sound ?? it.meaning}
            </span>
            {canSpeak && <Volume2 className="size-3.5 text-neutral-400" aria-hidden />}
          </button>
        ))}
      </div>

      <div className="flex-1" />
      <button
        type="button"
        onClick={onStart}
        className="mt-6 w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white"
      >
        {t.learn.script.introContinue}
      </button>
    </div>
  );
}
