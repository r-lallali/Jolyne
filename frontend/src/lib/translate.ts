// Client HTTP minimal pour /api/translate. La traduction tape le backend Go
// (qui relaie sur LibreTranslate self-host). Pas d'appel direct LT depuis
// le navigateur — pas de clé exposée + contrôle quota côté serveur.
//
// Quota Free = 10 traductions/jour. Identité : userID (cookie, credentials:
// include) ou fingerprint device (en-tête X-Device-FP) pour les anonymes.

import { getFingerprint } from "./fingerprint";

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export class TranslateError extends Error {}

// Quota quotidien atteint (HTTP 429) — l'appelant propose le paywall Premium.
export class TranslateQuotaError extends TranslateError {}

export interface TranslateResult {
  translated: string;
  // Traductions restantes aujourd'hui (Free). -1 = illimité (Premium).
  remaining: number;
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
  const data = (await res.json()) as { translated: string; remaining?: number };
  return { translated: data.translated, remaining: data.remaining ?? -1 };
}
