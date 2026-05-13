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
