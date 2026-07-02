// Client HTTP pour /api/vocab — le carnet de vocabulaire. Toutes les routes
// requièrent une session user (credentials:include). Le backend HTML-escape
// term/translation à l'insert ; on décode les entités à l'affichage.

import { decodeEntities } from "@/lib/sanitize";

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export class VocabError extends Error {
  status: number;
  constructor(msg: string, status: number) {
    super(msg);
    this.status = status;
  }
}

export interface VocabEntry {
  id: number;
  term: string;
  translation: string;
  source_lang: string;
  target_lang: string;
  created_at: string; // ISO
}

function decode(e: VocabEntry): VocabEntry {
  return {
    ...e,
    term: decodeEntities(e.term),
    translation: decodeEntities(e.translation),
  };
}

export async function listVocab(): Promise<VocabEntry[]> {
  const res = await fetch(`${BASE}/api/vocab`, { credentials: "include" });
  if (!res.ok) throw new VocabError(`vocab: ${res.status}`, res.status);
  const data = (await res.json()) as { entries: VocabEntry[] };
  return (data.entries ?? []).map(decode);
}

export interface SaveVocabInput {
  term: string;
  translation: string;
  source: string;
  target: string;
}

export async function saveVocab(input: SaveVocabInput): Promise<VocabEntry> {
  const res = await fetch(`${BASE}/api/vocab`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      term: input.term,
      translation: input.translation,
      source_lang: input.source,
      target_lang: input.target,
    }),
  });
  if (!res.ok) throw new VocabError(`vocab: ${res.status}`, res.status);
  return decode((await res.json()) as VocabEntry);
}

export async function deleteVocab(id: number): Promise<void> {
  const res = await fetch(`${BASE}/api/vocab/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new VocabError(`vocab: ${res.status}`, res.status);
}

// practiceItems : entrées du carnet exploitables pour réviser la langue `lang`
// (quel que soit le sens d'enregistrement), sous forme (mot cible, sens),
// dédupliquées par cible. Alimente le lecteur de révision (buildExercises).
export function practiceItems(
  entries: VocabEntry[],
  lang: string,
): { target: string; meaning: string }[] {
  const seen = new Set<string>();
  const out: { target: string; meaning: string }[] = [];
  for (const e of entries) {
    let target = "";
    let meaning = "";
    if (e.source_lang === lang) {
      target = e.term;
      meaning = e.translation;
    } else if (e.target_lang === lang) {
      target = e.translation;
      meaning = e.term;
    } else {
      continue;
    }
    target = target.trim();
    meaning = meaning.trim();
    const key = target.toLowerCase();
    if (!target || !meaning || seen.has(key)) continue;
    seen.add(key);
    out.push({ target, meaning });
  }
  return out;
}
