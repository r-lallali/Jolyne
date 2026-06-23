// Beacon analytics côté front : envoie des événements de funnel anonymes au
// backend (POST /api/events). Aucun contenu sensible — juste le nom de l'event,
// la paire de langues éventuelle et des props courtes.
//
// On utilise fetch+keepalive (et non navigator.sendBeacon) car il faut
// transmettre l'en-tête X-Device-FP pour corréler les visites anonymes ; le
// fingerprint sert d'anon_id (hashé côté serveur). Respecte Do-Not-Track.

import { getFingerprint } from "./fingerprint";

const BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "";

// Événements que le front a le droit d'émettre (doit matcher publicAllowed Go).
export type TrackEvent =
  | "page_view"
  | "signup_started"
  | "match_search_started";

interface TrackOptions {
  lang_from?: string;
  lang_to?: string;
  props?: Record<string, unknown>;
}

function doNotTrack(): boolean {
  if (typeof navigator === "undefined") return true;
  return (
    navigator.doNotTrack === "1" ||
    (typeof window !== "undefined" &&
      (window as unknown as { doNotTrack?: string }).doNotTrack === "1")
  );
}

export async function track(name: TrackEvent, opts: TrackOptions = {}): Promise<void> {
  if (typeof window === "undefined" || doNotTrack()) return;
  try {
    const fp = await getFingerprint().catch(() => "");
    await fetch(`${BASE}/api/events`, {
      method: "POST",
      keepalive: true, // survit à la navigation / fermeture d'onglet
      credentials: "include", // attache le cookie de session si connecté
      headers: { "Content-Type": "application/json", "X-Device-FP": fp },
      body: JSON.stringify({
        name,
        lang_from: opts.lang_from,
        lang_to: opts.lang_to,
        props: opts.props,
      }),
    });
  } catch {
    // L'analytics ne doit jamais casser l'UX : on avale silencieusement.
  }
}
