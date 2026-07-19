// Critères de robustesse du mot de passe (signup / reset). Affichés en
// checklist rouge → vert sous le champ ; le serveur rejoue exactement les
// mêmes règles (règle d'or #3 — users.ValidatePassword côté Go).

export type PasswordCriterion = "length" | "upper" | "lower" | "digit";

export const PASSWORD_CRITERIA: readonly PasswordCriterion[] = [
  "length",
  "upper",
  "lower",
  "digit",
];

// Unicode-aware : É compte comme majuscule, ٣ comme chiffre — cohérent
// avec unicode.IsUpper/IsLower/IsDigit côté serveur.
const RE: Record<Exclude<PasswordCriterion, "length">, RegExp> = {
  upper: /\p{Lu}/u,
  lower: /\p{Ll}/u,
  digit: /\p{Nd}/u,
};

export function checkPasswordCriterion(
  criterion: PasswordCriterion,
  password: string,
): boolean {
  if (criterion === "length") return password.length >= 8;
  return RE[criterion].test(password);
}

export function passwordValid(password: string): boolean {
  return PASSWORD_CRITERIA.every((c) => checkPasswordCriterion(c, password));
}
