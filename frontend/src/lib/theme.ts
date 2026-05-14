"use client";

import { useEffect, useState } from "react";

const KEY = "jolyne_theme";

export type Theme = "light" | "dark";

function readInitial(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function apply(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
}

// useTheme retourne le thème actuel et un toggle. Le rendu initial côté
// serveur est forcément "dark" (pas d'accès à localStorage / matchMedia) ;
// l'effet client réajuste après le mount. Un bref flash possible pour les
// utilisateurs en mode clair — acceptable pour MVP, on règlera plus tard
// via un script no-flash si besoin.
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const initial = readInitial();
    setTheme(initial);
    apply(initial);
  }, []);

  const toggle = () => {
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      window.localStorage.setItem(KEY, next);
      apply(next);
      return next;
    });
  };

  return [theme, toggle];
}
