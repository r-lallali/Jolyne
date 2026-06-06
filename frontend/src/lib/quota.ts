// Client pour GET /api/quota : état des compteurs du jour pour l'identité
// courante (userID via cookie si connecté, sinon fingerprint device via
// l'en-tête X-Device-FP). Sert au SetupView à afficher les messages prof IA
// restants et à griser l'option quand la limite est atteinte.

import { getFingerprint } from "./fingerprint";

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export interface QuotaUsage {
  used: number;
  // Plafond Free du jour. 0 = illimité (Premium).
  limit: number;
  // Restant. -1 = illimité (Premium).
  remaining: number;
}

export interface QuotaState {
  plan: "free" | "premium";
  bot: QuotaUsage;
  swipe: QuotaUsage;
  translate: QuotaUsage;
}

export async function fetchQuota(signal?: AbortSignal): Promise<QuotaState> {
  const fp = await getFingerprint().catch(() => "");
  const res = await fetch(`${BASE}/api/quota`, {
    credentials: "include",
    headers: { "X-Device-FP": fp },
    signal,
  });
  if (!res.ok) throw new Error(`quota: ${res.status}`);
  return (await res.json()) as QuotaState;
}
