"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { useT, useUILang } from "@/lib/i18n";
import { saveVocab } from "@/lib/vocab";

// Bouton « ajouter au carnet » utilisé partout dans le mode Cours (feedback
// d'exercice, récap de fin de leçon, intro des leçons d'écriture). Sauvegarde
// le couple (mot cible → sens dans la langue de l'apprenant) ; idempotent côté
// backend (re-sauver remonte simplement l'entrée). Rendu nul si le mot est déjà
// dans la langue de l'interface (rien à apprendre) ou si la paire est vide.
export function SaveWordButton({
  term,
  translation,
  lang,
  compact,
}: {
  term: string;
  translation: string;
  // lang : langue du mot `term` (la langue cible du cours).
  lang: string;
  // compact : icône seule (grilles serrées) au lieu de icône + libellé.
  compact?: boolean;
}) {
  const t = useT();
  const uiLang = useUILang();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  if (!term.trim() || !translation.trim() || lang === uiLang) return null;

  const handleSave = async () => {
    if (state === "saving" || state === "saved") return;
    setState("saving");
    try {
      await saveVocab({
        term: term.trim(),
        translation: translation.trim(),
        source: lang,
        target: uiLang,
      });
      setState("saved");
    } catch {
      setState("error");
    }
  };

  const saved = state === "saved";
  const label = saved
    ? t.vocab.saved
    : state === "error"
      ? t.vocab.saveError
      : t.vocab.save;
  const Icon = saved ? BookmarkCheck : Bookmark;

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleSave}
        disabled={state === "saving" || saved}
        aria-label={label}
        title={label}
        className={
          "shrink-0 rounded-lg p-1.5 transition-colors " +
          (saved
            ? "text-emerald-500"
            : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200")
        }
      >
        <Icon className="size-4" aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleSave}
      disabled={state === "saving" || saved}
      className={
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors " +
        (saved
          ? "border-emerald-300 text-emerald-600 dark:border-emerald-500/40 dark:text-emerald-400"
          : "border-neutral-200 text-neutral-600 hover:bg-white/60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900/60")
      }
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}
