export type LangCode =
  | "fr"
  | "en"
  | "es"
  | "de"
  | "pt"
  | "it"
  | "zh"
  | "ja"
  | "ko"
  | "ar";

// Source de vérité de l'ordre d'affichage des langues. Réutilisée par les
// pickers (setup) et la génération des paires — pas de liste dupliquée.
export const ALL_LANGS: readonly LangCode[] = [
  "fr",
  "en",
  "es",
  "de",
  "pt",
  "it",
  "zh",
  "ja",
  "ko",
  "ar",
];

// Noms natifs (autonymes) — affichés tels quels quelle que soit la langue UI.
export const LANG_LABEL: Record<LangCode, string> = {
  fr: "Français",
  en: "English",
  es: "Español",
  de: "Deutsch",
  pt: "Português",
  it: "Italiano",
  zh: "中文",
  ja: "日本語",
  ko: "한국어",
  ar: "العربية",
};

// Drapeaux emoji affichés à côté du nom de langue. 🇬🇧 plutôt que 🇺🇸 pour
// l'anglais, 🇵🇹 plutôt que 🇧🇷 pour le portugais — biais européen assumé.
// 🇸🇦 représente l'arabe (pas de drapeau « langue » dédié). À swapper si le
// public se révèle majoritairement d'une autre région.
export const LANG_FLAG: Record<LangCode, string> = {
  fr: "🇫🇷",
  en: "🇬🇧",
  es: "🇪🇸",
  de: "🇩🇪",
  pt: "🇵🇹",
  it: "🇮🇹",
  zh: "🇨🇳",
  ja: "🇯🇵",
  ko: "🇰🇷",
  ar: "🇸🇦",
};

export interface LangPair {
  speaks: LangCode;
  wants: LangCode;
}

// Toutes les paires de langues distinctes sont ouvertes (combinaisons
// complètes). Généré depuis ALL_LANGS pour rester aligné automatiquement
// quand on ajoute une langue.
export const ALLOWED_PAIRS: readonly LangPair[] = ALL_LANGS.flatMap((speaks) =>
  ALL_LANGS.filter((wants) => wants !== speaks).map((wants) => ({
    speaks,
    wants,
  })),
);

export function pairKey(p: LangPair): string {
  return `${p.speaks}->${p.wants}`;
}

// allowedWantsFor renvoie les langues cibles compatibles avec la langue
// parlée donnée. Sert à griser les choix non ouverts avant même d'envoyer
// la requête au serveur.
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
