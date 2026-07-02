"use client";

import { Volume2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { PlayItem } from "@/lib/learn";
import { speak, speechSupported } from "@/lib/speech";
import { SaveWordButton } from "@/components/learn/SaveWordButton";

// Présentation des nouveaux signes d'une leçon d'écriture, avant le quiz : une
// grille signe + prononciation, chaque carte audible (TTS). « On voit avant de
// reconnaître » — on n'interroge jamais un signe qui n'a pas été montré.
// Quand le signe porte un mot d'exemple traduit, il est affiché sous le signe,
// audible et ajoutable au carnet de vocabulaire.
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
    <div className="flex flex-1 flex-col overflow-y-auto">
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
        {t.learn.script.newSign}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((it) => (
          <div
            key={it.target}
            className="flex flex-col rounded-2xl border border-neutral-200 bg-white transition-colors hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/70 dark:hover:border-neutral-700"
          >
            <button
              type="button"
              onClick={() => canSpeak && speak(it.target, targetLang)}
              className="flex flex-1 flex-col items-center gap-1 px-3 pb-3 pt-5"
            >
              <span className="text-5xl font-bold text-neutral-900 dark:text-neutral-50">
                {it.target}
              </span>
              <span className="mt-1 text-sm font-medium text-sky-600 dark:text-sky-400">
                {it.sound ?? it.meaning}
              </span>
              {canSpeak && <Volume2 className="size-3.5 text-neutral-400" aria-hidden />}
            </button>
            {it.example && (
              <div className="flex items-center gap-1 border-t border-neutral-100 px-2.5 py-2 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={() => canSpeak && speak(it.example!, targetLang)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    {it.example}
                    {it.example_sound && (
                      <span className="ml-1 font-normal text-neutral-400 dark:text-neutral-500">
                        {it.example_sound}
                      </span>
                    )}
                  </span>
                  {it.example_meaning && (
                    <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {it.example_meaning}
                    </span>
                  )}
                </button>
                {it.example_meaning && (
                  <SaveWordButton
                    compact
                    term={it.example}
                    translation={it.example_meaning}
                    lang={targetLang}
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex-1" />
      <button
        type="button"
        onClick={onStart}
        className="mt-6 w-full shrink-0 rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white"
      >
        {t.learn.script.introContinue}
      </button>
    </div>
  );
}
