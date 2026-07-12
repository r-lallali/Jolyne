import { describe, expect, it } from "vitest";

import { containsProfanity } from "@/lib/profanity";

// Mirror client de la blocklist serveur : le serveur reste l'autorité, ces
// tests figent le contrat de normalisation (casse, accents, leet, séparateurs).
describe("containsProfanity", () => {
  it("détecte un terme banni tel quel", () => {
    expect(containsProfanity("pute")).toBe(true);
  });

  it("est insensible à la casse", () => {
    expect(containsProfanity("PuTe")).toBe(true);
  });

  it("normalise les accents", () => {
    expect(containsProfanity("pédo")).toBe(true);
  });

  it("normalise le leet speak", () => {
    expect(containsProfanity("p0rn")).toBe(true);
    expect(containsProfanity("pu7e")).toBe(true);
  });

  it("ignore les séparateurs non alphanumériques", () => {
    expect(containsProfanity("p.u.t.e")).toBe(true);
    expect(containsProfanity("f u c k")).toBe(true);
  });

  it("matche en sous-chaîne — permissif par design (le serveur tranche)", () => {
    expect(containsProfanity("analyse")).toBe(true);
  });

  it("laisse passer les pseudos ordinaires", () => {
    expect(containsProfanity("Marie")).toBe(false);
    expect(containsProfanity("dragon_bleu_92")).toBe(false);
    expect(containsProfanity("")).toBe(false);
  });
});
