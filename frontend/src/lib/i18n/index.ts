// API publique du module i18n.
//
// Usage : `const t = useT(); t.chat.placeholder` ou
//         `t.chat.chattingWith({ nick: "Alice" })`
//
// Résolution de la langue UI :
//   1. `sessionStore.uiLang` si l'utilisateur a choisi explicitement
//   2. `sessionStore.speaks` si présent et supporté
//   3. `navigator.language` (langue OS/navigateur) si supportée
//   4. "en" en dernier recours
//
// La résolution se fait dans un useEffect post-hydration pour éviter les
// mismatches SSR — au tout premier render on tombe sur "en" puis on patch.
// Le flash est invisible en pratique (zustand persist hydrate en < 10 ms).

import { useEffect, useState } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { de } from "@/lib/i18n/de";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { fr } from "@/lib/i18n/fr";
import { pt } from "@/lib/i18n/pt";
import { it } from "@/lib/i18n/it";
import { zh } from "@/lib/i18n/zh";
import { ja } from "@/lib/i18n/ja";
import { ko } from "@/lib/i18n/ko";
import { ar } from "@/lib/i18n/ar";
import type { Messages, UILang } from "@/lib/i18n/types";

export type { Messages, UILang } from "@/lib/i18n/types";

export const SUPPORTED_LANGS: readonly UILang[] = [
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

const DICTS: Record<UILang, Messages> = {
  fr,
  en,
  es,
  de,
  pt,
  it,
  zh,
  ja,
  ko,
  ar,
};

const FALLBACK: Messages = en;

function isSupported(s: string | null | undefined): s is UILang {
  return !!s && (SUPPORTED_LANGS as readonly string[]).includes(s);
}

function detectBrowserLang(): UILang | null {
  if (typeof navigator === "undefined") return null;
  const base = navigator.language.split("-")[0]?.toLowerCase();
  return isSupported(base) ? (base as UILang) : null;
}

export function getMessages(lang: UILang): Messages {
  return DICTS[lang] ?? FALLBACK;
}

export function resolveUILang(
  explicit: UILang | null,
  speaks: string | null,
): UILang {
  if (isSupported(explicit)) return explicit as UILang;
  if (isSupported(speaks)) return speaks as UILang;
  const browser = detectBrowserLang();
  if (browser) return browser;
  return "en";
}

// useUILang renvoie la langue UI résolue. Stable post-hydration, défault
// "en" au tout premier render pour éviter les warnings SSR.
export function useUILang(): UILang {
  const uiLang = useSessionStore((s) => s.uiLang);
  const speaks = useSessionStore((s) => s.speaks);
  const [lang, setLang] = useState<UILang>("en");
  useEffect(() => {
    setLang(resolveUILang(uiLang, speaks));
  }, [uiLang, speaks]);
  return lang;
}

// useT renvoie le dico courant. Composant typique :
//   const t = useT();
//   <p>{t.chat.placeholder}</p>
//   <p>{t.chat.chattingWith({ nick })}</p>
export function useT(): Messages {
  const lang = useUILang();
  return getMessages(lang);
}
