import { describe, expect, it } from "vitest";

import { detectPII } from "@/lib/pii";

// La détection est volontairement permissive (faux positifs OK : le flow
// demande confirmation, il ne bloque pas). Les tests figent surtout les
// NON-détections — un faux négatif laisserait fuiter du PII sans confirmation.
describe("detectPII", () => {
  it("détecte les URLs sous leurs formes usuelles", () => {
    expect(detectPII("regarde https://example.com c'est top")).toBe("url");
    expect(detectPII("va sur www.monsite.fr")).toBe("url");
    expect(detectPII("monsite.com/profil")).toBe("url");
  });

  it("détecte les e-mails", () => {
    expect(detectPII("écris-moi : jean.dupont+chat@mail.example.org")).toBe(
      "email",
    );
  });

  it("détecte les numéros de téléphone (≥ 9 chiffres, séparateurs variés)", () => {
    expect(detectPII("appelle le 06 12 34 56 78")).toBe("phone");
    expect(detectPII("+33612345678")).toBe("phone");
    expect(detectPII("06-12-34-56-78")).toBe("phone");
  });

  it("détecte les handles de réseaux sociaux", () => {
    expect(detectPII("suis-moi sur @mon_insta")).toBe("handle");
  });

  it("l'e-mail prime sur le handle (les deux motifs contiennent un @)", () => {
    expect(detectPII("contact@exemple.fr")).toBe("email");
  });

  it("laisse passer les messages ordinaires", () => {
    expect(detectPII("Bonjour, comment ça va ?")).toBeNull();
    expect(detectPII("On se retrouve à 18h30.")).toBeNull();
    expect(detectPII("J'ai eu 12/20 à mon examen le 3.10")).toBeNull();
    expect(detectPII("")).toBeNull();
  });

  it("ne prend pas moins de 9 chiffres pour un téléphone", () => {
    expect(detectPII("le code postal 75011 et l'an 2026")).toBeNull();
    expect(detectPII("12345678")).toBeNull();
  });
});
