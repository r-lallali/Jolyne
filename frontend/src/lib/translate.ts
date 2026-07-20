// Client HTTP minimal pour /api/translate. La traduction tape le backend Go
// (qui relaie sur LibreTranslate self-host). Pas d'appel direct LT depuis
// le navigateur — pas de clé exposée + rate-limit côté serveur.
//
// Traductions illimitées pour tous les plans. Identité (rate-limit anti-abus
// seulement) : userID (cookie, credentials: include) ou fingerprint device
// (en-tête X-Device-FP) pour les anonymes.

import { getFingerprint } from "./fingerprint";

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export class TranslateError extends Error {}

// HTTP 429 = rate-limit anti-abus serveur (jamais atteint par un usage
// humain normal) — l'appelant traite comme une erreur transitoire.
export class TranslateQuotaError extends TranslateError {}

export interface TranslateResult {
  translated: string;
  // Langue source détectée par le serveur (détection auto ou chemin IA).
  // Sert à afficher la vraie langue dans le popover et à sauver un code
  // exploitable dans le carnet de vocab.
  detected?: string;
  // Romanisation du texte source (pinyin, rōmaji…) — présente uniquement
  // sur le chemin IA pour les sources zh/ja/ko/ar.
  romanization?: string;
}

export async function translateText(
  text: string,
  source: string,
  target: string,
): Promise<TranslateResult> {
  const fp = await getFingerprint().catch(() => "");
  const res = await fetch(`${BASE}/api/translate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Device-FP": fp },
    body: JSON.stringify({ text, source, target }),
  });
  if (res.status === 429) throw new TranslateQuotaError("translate: quota");
  if (!res.ok) throw new TranslateError(`translate: ${res.status}`);
  const data = (await res.json()) as {
    translated: string;
    detected?: string;
    romanization?: string;
  };
  return {
    translated: data.translated,
    detected: data.detected || undefined,
    romanization: data.romanization || undefined,
  };
}

// Langues du site écrites en alphabet latin — pour lesquelles on fait
// confiance à la langue « attendue » de la conversation plutôt qu'à la
// détection auto (peu fiable sur un mot isolé).
const LATIN_SCRIPT_LANGS = new Set(["fr", "en", "es", "de", "pt", "it"]);

// guessSourceLang devine la langue source d'un texte sélectionné dans le
// chat. Le peer n'écrit pas forcément dans la langue attendue (`expected`,
// typiquement le `wants` du user) : il peut alterner, ou un ami peut parler
// une tout autre langue. Les scripts non-latins identifient la langue sans
// ambiguïté parmi celles du site : kana → ja, hangul → ko, han seul → zh,
// arabe → ar. Pour du latin on garde `expected` s'il est cohérent (script
// latin lui aussi), sinon on délègue la détection au serveur ("auto").
export function guessSourceLang(
  text: string,
  expected: string | null,
): string {
  // hiragana / katakana
  if (/[぀-ヿ]/.test(text)) return "ja";
  // hangul
  if (/[가-힯]/.test(text)) return "ko";
  // han (CJK unifié + ext. A) sans kana → chinois
  if (/[㐀-䶿一-鿿]/.test(text)) return "zh";
  // arabe
  if (/[؀-ۿ]/.test(text)) return "ar";
  if (expected && LATIN_SCRIPT_LANGS.has(expected)) return expected;
  return "auto";
}
