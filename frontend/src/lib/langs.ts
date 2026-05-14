export type LangCode = "fr" | "en" | "es" | "de";

export const LANG_LABEL: Record<LangCode, string> = {
  fr: "Français",
  en: "English",
  es: "Español",
  de: "Deutsch",
};

export interface LangPair {
  speaks: LangCode;
  wants: LangCode;
}

// Paires ouvertes au lancement — voir PLAN.md §8.
export const ALLOWED_PAIRS: readonly LangPair[] = [
  { speaks: "fr", wants: "en" },
  { speaks: "en", wants: "fr" },
  { speaks: "es", wants: "en" },
  { speaks: "en", wants: "es" },
  { speaks: "de", wants: "en" },
  { speaks: "en", wants: "de" },
  { speaks: "fr", wants: "es" },
  { speaks: "es", wants: "fr" },
];

export function pairKey(p: LangPair): string {
  return `${p.speaks}->${p.wants}`;
}

// allowedWantsFor renvoie les langues cibles compatibles avec la langue
// parlée donnée. Sert à griser les choix non ouverts au lancement
// (cf. PLAN.md §8) avant même d'envoyer la requête au serveur.
export function allowedWantsFor(speaks: LangCode | null): LangCode[] {
  if (!speaks) return [];
  return ALLOWED_PAIRS.filter((p) => p.speaks === speaks).map((p) => p.wants);
}

export function isPairAllowed(
  speaks: LangCode | null,
  wants: LangCode | null,
): boolean {
  if (!speaks || !wants) return false;
  return ALLOWED_PAIRS.some(
    (p) => p.speaks === speaks && p.wants === wants,
  );
}
