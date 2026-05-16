// Client minimal pour /api/queue-size. Renvoie le nombre de peers déjà en
// attente sur la paire choisie (côté serveur : LLEN de la queue cible).

import type { LangCode } from "@/lib/langs";

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

export async function fetchQueueSize(
  speaks: LangCode,
  wants: LangCode,
  signal?: AbortSignal,
): Promise<number> {
  const res = await fetch(
    `${BASE}/api/queue-size?speaks=${speaks}&wants=${wants}`,
    { signal },
  );
  if (!res.ok) throw new Error(`queue-size: ${res.status}`);
  const data = (await res.json()) as { count: number };
  return data.count;
}
