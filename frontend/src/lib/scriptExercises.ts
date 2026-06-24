// Génération des exercices d'une leçon d'ÉCRITURE (apprentissage d'un système
// d'écriture : kana, jamo Hangul, abjad arabe, caractères chinois) à partir de
// ses items enrichis (signe + prononciation + éventuelles formes/parts/strokes).
//
// Types d'exercices, du plus simple au plus innovant :
//   - recognize : voir le signe → choisir sa prononciation (QCM)
//   - recall    : voir la prononciation → choisir le signe (QCM)
//   - listen    : entendre le signe (TTS) → choisir le signe
//   - compose   : (Hangul) assembler un bloc-syllabe à partir de ses jamo
//   - forms     : (arabe) choisir la bonne forme selon la position dans le mot
//   - trace     : tracer le signe au doigt (guide d'ordre des traits si dispo)
//   - match     : associer des paires signe ↔ son
// Les distracteurs proviennent des autres items de la leçon — rien à stocker en
// plus, tout reste dans le périmètre de la leçon.

import type { PlayItem } from "@/lib/learn";
import { speechSupported } from "@/lib/speech";

export type ScriptExercise =
  | {
      kind: "recognize";
      glyph: string;
      sound: string;
      options: string[];
    }
  | {
      kind: "recall";
      sound: string;
      glyph: string;
      options: string[];
    }
  | {
      kind: "listen";
      glyph: string;
      sound: string;
      options: string[];
    }
  | {
      kind: "compose";
      glyph: string;
      sound: string;
      parts: string[];
      tiles: string[];
    }
  | {
      kind: "forms";
      glyph: string;
      sound: string;
      // position : index dans forms (1 initiale, 2 médiane, 3 finale).
      position: number;
      answer: string;
      options: string[];
    }
  | {
      kind: "trace";
      glyph: string;
      sound: string;
      strokes?: string[];
    }
  | {
      kind: "match";
      pairs: { glyph: string; sound: string }[];
    };

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

function sampleDistinct(pool: string[], exclude: string, n: number): string[] {
  const seen = new Set([exclude]);
  const out: string[] = [];
  for (const v of shuffle(pool)) {
    if (out.length >= n) break;
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

// isSingleGlyph : un seul caractère affichable (signe isolé, pas un mot de
// lecture). Sert à n'autoriser le tracé que sur les signes uniques.
function isSingleGlyph(s: string): boolean {
  return [...s].length === 1;
}

// buildScriptExercises : séquence d'exercices d'une leçon d'écriture. On dérive
// les activités spécifiques (compose / forms) quand l'item porte la donnée, et
// on alterne reconnaissance / rappel / écoute sinon ; on saupoudre du tracé sur
// les premiers signes et on termine par un exercice d'association.
export function buildScriptExercises(items: PlayItem[]): ScriptExercise[] {
  const valid = items.filter((it) => it.target && (it.sound ?? it.meaning));
  if (valid.length === 0) return [];

  const sound = (it: PlayItem): string => it.sound ?? it.meaning;
  const glyphs = valid.map((it) => it.target);
  const sounds = valid.map(sound);
  const canListen = speechSupported();

  // Banque de formes par position (pour les distracteurs de l'exercice arabe).
  const formsAt = (pos: number): string[] =>
    valid.flatMap((it) => (it.forms && it.forms[pos] ? [it.forms[pos] as string] : []));

  const ex: ScriptExercise[] = [];
  let traced = 0;
  const traceBudget = Math.min(2, valid.filter((it) => isSingleGlyph(it.target)).length);

  valid.forEach((it, i) => {
    const s = sound(it);

    // Composition Hangul : assembler le bloc à partir de ses jamo.
    if (it.parts && it.parts.length >= 2) {
      const distractors = sampleDistinct(
        valid.flatMap((v) => v.parts ?? []),
        "",
        2,
      ).filter((p) => !it.parts!.includes(p));
      ex.push({
        kind: "compose",
        glyph: it.target,
        sound: s,
        parts: it.parts,
        tiles: shuffle([...it.parts, ...distractors]),
      });
    } else if (it.forms && it.forms.length === 4) {
      // Formes positionnelles arabes : on interroge une position de jonction
      // (1 initiale, 2 médiane, 3 finale) choisie de façon stable par item.
      const position = 1 + (i % 3);
      const answer = it.forms[position] as string;
      const options = shuffle([
        answer,
        ...sampleDistinct(formsAt(position), answer, 3),
      ]);
      ex.push({ kind: "forms", glyph: it.target, sound: s, position, answer, options });
    } else {
      // Alternance reconnaissance / rappel / écoute.
      const mode = i % 3;
      if (mode === 0) {
        ex.push({
          kind: "recognize",
          glyph: it.target,
          sound: s,
          options: shuffle([s, ...sampleDistinct(sounds, s, 3)]),
        });
      } else if (mode === 1 || !canListen) {
        ex.push({
          kind: "recall",
          sound: s,
          glyph: it.target,
          options: shuffle([it.target, ...sampleDistinct(glyphs, it.target, 3)]),
        });
      } else {
        ex.push({
          kind: "listen",
          glyph: it.target,
          sound: s,
          options: shuffle([it.target, ...sampleDistinct(glyphs, it.target, 3)]),
        });
      }
    }

    // Tracé : sur les premiers signes uniques, juste après les avoir vus.
    if (traced < traceBudget && isSingleGlyph(it.target)) {
      ex.push({ kind: "trace", glyph: it.target, sound: s, strokes: it.strokes });
      traced += 1;
    }
  });

  // Association finale signe ↔ son (jusqu'à 4 paires) si assez de matière.
  if (valid.length >= 3) {
    const pairs = shuffle(valid)
      .slice(0, 4)
      .map((it) => ({ glyph: it.target, sound: sound(it) }));
    ex.push({ kind: "match", pairs });
  }

  return ex;
}
