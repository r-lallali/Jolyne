// Heuristiques anti-doxing / anti-grooming sur les messages sortants.
// Volontairement permissif côté détection (faux-positifs OK) parce que le
// flow demande confirmation au user, pas un blocage.

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[\w.-]+\.[a-z]{2,}\/\S*/i;
const EMAIL_RE = /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i;
// Téléphone : au moins 9 chiffres, éventuellement entrecoupés d'espaces,
// tirets, points ou parenthèses, avec un + optionnel devant.
const PHONE_RE = /\+?\d(?:[\s.\-()]?\d){8,}/;
const HANDLE_RE = /@[A-Za-z0-9_.]{3,}\b/;

export type PIIKind = "url" | "email" | "phone" | "handle";

export function detectPII(text: string): PIIKind | null {
  if (URL_RE.test(text)) return "url";
  if (EMAIL_RE.test(text)) return "email";
  if (PHONE_RE.test(text)) return "phone";
  if (HANDLE_RE.test(text)) return "handle";
  return null;
}
