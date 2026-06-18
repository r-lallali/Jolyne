// Génération des exercices d'une leçon à partir de ses items (mot/phrase cible
// + sens dans la langue de l'apprenant). On dérive trois types d'exercices :
//   - choose    : QCM (montrer la cible → choisir le sens, ou l'inverse)
//   - assemble  : reconstituer la phrase cible depuis une banque de mots
//   - match     : associer des paires cible ↔ sens
// Les distracteurs proviennent des autres items de la leçon : aucun contenu
// supplémentaire à stocker, et tout est dans la langue de l'apprenant.

import type { PlayItem } from "@/lib/learn";

export type Exercise =
  | {
      kind: "choose";
      // direction : "to-meaning" montre la cible, on choisit le sens.
      mode: "to-meaning" | "to-target";
      question: string;
      answer: string;
      options: string[];
      // mot cible associé (pour le bouton audio).
      target: string;
    }
  | {
      kind: "assemble";
      meaning: string;
      target: string;
      tokens: string[];
    }
  | {
      kind: "match";
      pairs: { target: string; meaning: string }[];
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

// buildExercises : construit la séquence d'exercices d'une leçon. `items` est
// l'ordre pédagogique ; on alterne les types et on termine par un exercice
// d'association quand il y a assez d'items.
export function buildExercises(items: PlayItem[]): Exercise[] {
  const valid = items.filter((it) => it.target && it.meaning);
  if (valid.length === 0) return [];

  const targets = valid.map((it) => it.target);
  const meanings = valid.map((it) => it.meaning);
  const ex: Exercise[] = [];

  valid.forEach((it, i) => {
    const isMultiWord = it.target.trim().split(/\s+/).length > 1;
    // Un item multi-mots sur deux devient un exercice d'assemblage.
    if (isMultiWord && i % 2 === 1) {
      const correct = it.target.trim().split(/\s+/);
      const distractorWords = sampleDistinct(
        targets.flatMap((t) => t.trim().split(/\s+/)),
        it.target,
        2,
      ).filter((w) => !correct.includes(w));
      ex.push({
        kind: "assemble",
        meaning: it.meaning,
        target: it.target,
        tokens: shuffle([...correct, ...distractorWords]),
      });
      return;
    }
    const toMeaning = i % 2 === 0;
    if (toMeaning) {
      const options = shuffle([
        it.meaning,
        ...sampleDistinct(meanings, it.meaning, 3),
      ]);
      ex.push({
        kind: "choose",
        mode: "to-meaning",
        question: it.target,
        answer: it.meaning,
        options,
        target: it.target,
      });
    } else {
      const options = shuffle([
        it.target,
        ...sampleDistinct(targets, it.target, 3),
      ]);
      ex.push({
        kind: "choose",
        mode: "to-target",
        question: it.meaning,
        answer: it.target,
        options,
        target: it.target,
      });
    }
  });

  // Exercice d'association final (jusqu'à 5 paires) si assez de matière.
  if (valid.length >= 3) {
    const pairs = shuffle(valid)
      .slice(0, 5)
      .map((it) => ({ target: it.target, meaning: it.meaning }));
    ex.push({ kind: "match", pairs });
  }

  return ex;
}
