import { describe, expect, it } from "vitest";
import { checkPasswordCriterion, passwordValid } from "./password";

describe("passwordValid", () => {
  it("accepte un mot de passe conforme aux 4 critères", () => {
    expect(passwordValid("Abcdef12")).toBe(true);
  });

  it("rejette chaque critère manquant isolément", () => {
    expect(passwordValid("Abc12")).toBe(false); // trop court
    expect(passwordValid("abcdef12")).toBe(false); // pas de majuscule
    expect(passwordValid("ABCDEF12")).toBe(false); // pas de minuscule
    expect(passwordValid("Abcdefgh")).toBe(false); // pas de chiffre
    expect(passwordValid("")).toBe(false);
  });

  it("est Unicode-aware (majuscule accentuée, chiffre non latin)", () => {
    expect(checkPasswordCriterion("upper", "Émile")).toBe(true);
    expect(checkPasswordCriterion("digit", "abc٣def")).toBe(true);
    expect(checkPasswordCriterion("lower", "ÀÉÎ1234é")).toBe(true);
  });

  it("évalue chaque critère indépendamment", () => {
    expect(checkPasswordCriterion("length", "12345678")).toBe(true);
    expect(checkPasswordCriterion("length", "1234567")).toBe(false);
    expect(checkPasswordCriterion("upper", "abc")).toBe(false);
  });
});
