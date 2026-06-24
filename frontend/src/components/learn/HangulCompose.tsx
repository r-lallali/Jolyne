"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import { ScriptFooter } from "@/components/learn/ScriptFooter";

// Exercice de COMPOSITION (Hangul) : assembler un bloc-syllabe à partir de ses
// jamo, dans l'ordre. On valide la séquence choisie contre l'ordre attendu
// (`parts`) — pas de composition Unicode : on révèle le bloc cible (`glyph`)
// une fois correct. Reflète le fonctionnement réel du coréen (consonne + voyelle
// [+ consonne finale] empilées en un bloc).
export function HangulCompose({
  glyph,
  sound,
  parts,
  tiles,
  onDone,
}: {
  glyph: string;
  sound: string;
  parts: string[];
  tiles: string[];
  onDone: (mistakes: number) => void;
}) {
  const t = useT();
  const [built, setBuilt] = useState<number[]>([]);
  const [checked, setChecked] = useState(false);
  const used = new Set(built);
  const sequence = built.map((i) => tiles[i]);
  const correct =
    sequence.length === parts.length && sequence.every((j, i) => j === parts[i]);

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
        {t.learn.script.composePrompt}
      </p>
      <p className="mt-1 text-lg font-bold text-sky-600 dark:text-sky-400">
        {sound}
      </p>

      {/* Aperçu du bloc en construction (ou le bloc cible une fois réussi) */}
      <div className="mt-6 flex items-center justify-center">
        <div className="grid size-28 place-items-center rounded-2xl border-2 border-dashed border-neutral-200 text-6xl font-bold text-neutral-900 dark:border-neutral-800 dark:text-neutral-50">
          {correct && checked ? glyph : sequence.join(" ") || "···"}
        </div>
      </div>

      {/* Ligne d'assemblage (cliquer pour retirer) */}
      <div className="mt-6 flex min-h-[3rem] flex-wrap content-start justify-center gap-2">
        {built.map((tileIdx, pos) => (
          <button
            key={`${tileIdx}-${pos}`}
            type="button"
            disabled={checked}
            onClick={() => setBuilt((b) => b.filter((_, p) => p !== pos))}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-2xl font-medium text-neutral-900 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
          >
            {tiles[tileIdx]}
          </button>
        ))}
      </div>

      {/* Banque de jamo */}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {tiles.map((tok, i) =>
          used.has(i) ? (
            <span
              key={i}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-2xl text-transparent dark:border-neutral-800"
            >
              {tok}
            </span>
          ) : (
            <button
              key={i}
              type="button"
              disabled={checked}
              onClick={() => setBuilt((b) => [...b, i])}
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-2xl font-medium text-neutral-900 shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
            >
              {tok}
            </button>
          ),
        )}
      </div>

      <div className="flex-1" />
      <ScriptFooter
        checked={checked}
        correct={correct}
        canCheck={built.length === parts.length}
        answer={glyph}
        onCheck={() => setChecked(true)}
        onNext={() => onDone(correct ? 0 : 1)}
      />
    </div>
  );
}
