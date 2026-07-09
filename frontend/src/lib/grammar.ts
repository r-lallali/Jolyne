// Client HTTP minimal pour /api/grammar. Wrap LanguageTool self-host via
// le backend Go.

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

// Un check qui dépasse ce délai est abandonné : mieux vaut un message
// « indisponible » qu'un spinner infini sur le bouton Corriger.
const TIMEOUT_MS = 10_000;

// Cache de session : le même brouillon est souvent revérifié (re-clic sur
// Corriger, édition annulée). Un hit répond sans réseau. Map préserve
// l'ordre d'insertion → éviction du plus ancien au-delà du plafond.
const cache = new Map<string, GrammarMatch[]>();
const CACHE_MAX = 200;

export interface GrammarMatch {
  message: string;
  short_message?: string;
  offset: number;
  length: number;
  replacements: string[];
}

export class GrammarError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function checkGrammar(
  text: string,
  lang: string,
): Promise<GrammarMatch[]> {
  const key = `${lang}\u0000${text}`;
  const hit = cache.get(key);
  if (hit) {
    // Ré-insertion pour rafraîchir la position LRU.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  let matches: GrammarMatch[];
  try {
    matches = await postCheck(text, lang);
  } catch (e) {
    // Un seul retry, uniquement sur panne transitoire (coupure réseau ou
    // 5xx backend) — jamais sur 4xx (même requête = même refus) ni sur
    // timeout (le user a déjà attendu 10 s).
    if (!isTransient(e)) throw e;
    await new Promise((res) => setTimeout(res, 400));
    matches = await postCheck(text, lang);
  }

  cache.set(key, matches);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return matches;
}

async function postCheck(text: string, lang: string): Promise<GrammarMatch[]> {
  const res = await fetch(`${BASE}/api/grammar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new GrammarError(`grammar: ${res.status}`, res.status);
  const data = (await res.json()) as { matches: GrammarMatch[] };
  return data.matches ?? [];
}

function isTransient(e: unknown): boolean {
  if (e instanceof GrammarError) return (e.status ?? 0) >= 500;
  // fetch rejette en TypeError sur coupure réseau ; AbortSignal.timeout
  // rejette en TimeoutError (exclu : on ne double pas l'attente).
  return e instanceof TypeError;
}
