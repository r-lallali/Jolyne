"use client";

import { useEffect } from "react";
import { useUILang } from "@/lib/i18n";

// Langues à écriture droite-à-gauche. Seul l'arabe pour l'instant.
const RTL_LANGS = new Set<string>(["ar"]);

// Le <html lang> est rendu statiquement côté serveur (cf. layout) car la
// langue UI n'est résolue qu'après hydratation (zustand persist). Ce composant
// recale `lang` et `dir` sur l'élément racine une fois la langue connue, pour
// que le lecteur d'écran annonce la bonne langue et que l'arabe passe en RTL.
export function HtmlLangSync() {
  const lang = useUILang();
  useEffect(() => {
    const el = document.documentElement;
    el.lang = lang;
    el.dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";
  }, [lang]);
  return null;
}
