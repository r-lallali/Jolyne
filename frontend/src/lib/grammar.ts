// Client HTTP minimal pour /api/grammar. Wrap LanguageTool self-host via
// le backend Go.

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export interface GrammarMatch {
  message: string;
  short_message?: string;
  offset: number;
  length: number;
  replacements: string[];
}

export class GrammarError extends Error {}

export async function checkGrammar(
  text: string,
  lang: string,
): Promise<GrammarMatch[]> {
  const res = await fetch(`${BASE}/api/grammar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang }),
  });
  if (!res.ok) throw new GrammarError(`grammar: ${res.status}`);
  const data = (await res.json()) as { matches: GrammarMatch[] };
  return data.matches ?? [];
}
