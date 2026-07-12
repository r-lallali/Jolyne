import { describe, expect, it } from "vitest";

import { buildExercises } from "@/lib/learnExercises";
import type { PlayItem } from "@/lib/learn";

const item = (target: string, meaning: string): PlayItem => ({
  target,
  meaning,
});

// Les exercices sont mélangés (Math.random) : on vérifie des invariants
// (composition, unicité, présence de la réponse), jamais un ordre précis.
describe("buildExercises", () => {
  it("renvoie [] sans items exploitables", () => {
    expect(buildExercises([])).toEqual([]);
    expect(buildExercises([item("", "vide"), item("hola", "")])).toEqual([]);
  });

  it("un seul item → un QCM to-meaning contenant la bonne réponse", () => {
    const ex = buildExercises([item("hola", "salut")]);
    expect(ex).toHaveLength(1);
    const only = ex[0];
    if (only?.kind !== "choose") throw new Error("QCM attendu");
    expect(only.mode).toBe("to-meaning");
    expect(only.question).toBe("hola");
    expect(only.answer).toBe("salut");
    expect(only.options).toContain("salut");
  });

  it("alterne to-meaning (pair) et to-target (impair) pour les mots simples", () => {
    const ex = buildExercises([
      item("uno", "un"),
      item("dos", "deux"),
      item("tres", "trois"),
      item("cuatro", "quatre"),
    ]);
    const choose = ex.filter((e) => e.kind === "choose");
    expect(choose.map((e) => e.mode)).toEqual([
      "to-meaning",
      "to-target",
      "to-meaning",
      "to-target",
    ]);
  });

  it("les options d'un QCM sont uniques et contiennent la réponse exactement une fois", () => {
    const ex = buildExercises([
      item("uno", "un"),
      item("dos", "deux"),
      item("tres", "trois"),
      item("cuatro", "quatre"),
      item("cinco", "cinq"),
    ]);
    for (const e of ex) {
      if (e.kind !== "choose") continue;
      expect(new Set(e.options).size).toBe(e.options.length);
      expect(e.options.filter((o) => o === e.answer)).toHaveLength(1);
      expect(e.options.length).toBeLessThanOrEqual(4);
    }
  });

  it("un item multi-mots en position impaire devient un assemblage complet", () => {
    const ex = buildExercises([
      item("hola", "salut"),
      item("buenos días", "bonjour"),
    ]);
    const asm = ex.find((e) => e.kind === "assemble");
    if (!asm || asm.kind !== "assemble") throw new Error("assemblage attendu");
    expect(asm.target).toBe("buenos días");
    expect(asm.meaning).toBe("bonjour");
    // Tous les mots de la cible sont dans la banque de tokens.
    for (const w of "buenos días".split(" ")) {
      expect(asm.tokens).toContain(w);
    }
  });

  it("≥ 3 items → exercice d'association final avec des paires cohérentes", () => {
    const items = [
      item("uno", "un"),
      item("dos", "deux"),
      item("tres", "trois"),
    ];
    const ex = buildExercises(items);
    const last = ex[ex.length - 1];
    if (last?.kind !== "match") throw new Error("association attendue en fin");
    expect(last.pairs.length).toBeLessThanOrEqual(5);
    for (const p of last.pairs) {
      const src = items.find((it) => it.target === p.target);
      expect(src?.meaning).toBe(p.meaning);
    }
  });

  it("moins de 3 items → pas d'exercice d'association", () => {
    const ex = buildExercises([item("uno", "un"), item("dos", "deux")]);
    expect(ex.some((e) => e.kind === "match")).toBe(false);
  });
});
