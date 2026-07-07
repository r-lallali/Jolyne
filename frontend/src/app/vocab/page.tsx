"use client";

import { notFound } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Volume2 } from "lucide-react";
import { BackButton } from "@/components/ui/BackButton";
import { PracticePlayer } from "@/components/learn/PracticePlayer";
import type { LessonWord } from "@/components/learn/LessonPlayer";
import { ReviewPlayer } from "@/components/vocab/ReviewPlayer";
import { useT, useUILang } from "@/lib/i18n";
import { LANG_FLAG, LANG_LABEL, type LangCode } from "@/lib/langs";
import { speak, speechSupported } from "@/lib/speech";
import {
  listVocab,
  listDueVocab,
  deleteVocab,
  practiceItems,
  type VocabEntry,
} from "@/lib/vocab";
import { useUserStore } from "@/stores/userStore";

// Seuil d'entrées par langue pour proposer la révision (assez de distracteurs).
const PRACTICE_MIN_WORDS = 4;

export default function VocabPage() {
  const t = useT();
  const uiLang = useUILang();
  const user = useUserStore((s) => s.user);
  const hydrated = useUserStore((s) => s.hydrated);
  const [list, setList] = useState<VocabEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [practice, setPractice] = useState<{ lang: string; words: LessonWord[] } | null>(null);
  // Pile SRS : cartes dues + total. Rechargée à la fermeture du lecteur
  // (les cartes notées « again » redeviennent dues dans la session).
  const [due, setDue] = useState<{ entries: VocabEntry[]; totalDue: number }>({
    entries: [],
    totalDue: 0,
  });
  const [reviewing, setReviewing] = useState(false);
  const canSpeak = speechSupported();

  const refreshDue = () => {
    listDueVocab()
      .then(setDue)
      .catch(() => {});
  };

  useEffect(() => {
    if (!hydrated || !user) return;
    listVocab()
      .then(setList)
      .catch(() => {})
      .finally(() => setLoading(false));
    refreshDue();
  }, [hydrated, user]);

  // Langues révisables : côté étranger des entrées (≠ langue d'interface),
  // avec assez de mots pour construire des exercices.
  const practicable = useMemo(() => {
    const langs = new Set<string>();
    for (const e of list) {
      if (e.source_lang !== uiLang) langs.add(e.source_lang);
      if (e.target_lang !== uiLang) langs.add(e.target_lang);
    }
    return [...langs]
      .map((lang) => ({ lang, items: practiceItems(list, lang) }))
      .filter(({ items }) => items.length >= PRACTICE_MIN_WORDS);
  }, [list, uiLang]);

  // Suppression optimiste : on retire localement, puis on confirme côté API.
  // En cas d'échec réseau, on restaure l'entrée.
  const handleDelete = async (id: number) => {
    const prev = list;
    setList((l) => l.filter((e) => e.id !== id));
    try {
      await deleteVocab(id);
    } catch {
      setList(prev);
    }
  };

  // Côté « étranger » d'une entrée (mot à prononcer) : le terme si sa langue
  // n'est pas celle de l'interface, sinon la traduction.
  const foreignSide = (e: VocabEntry): { text: string; lang: string } =>
    e.source_lang !== uiLang
      ? { text: e.term, lang: e.source_lang }
      : { text: e.translation, lang: e.target_lang };

  if (!hydrated) return null;
  if (!user) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 pb-10 pt-[calc(env(safe-area-inset-top)+3.5rem)] sm:pt-10">
      <BackButton href="/" label={t.auth.backToApp} />
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          {t.vocab.title}
        </h1>
        {!loading && list.length > 0 && (
          <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
            {t.vocab.count({ count: list.length })}
          </span>
        )}
      </div>

      {/* Révision espacée (SRS) : cartes dues aujourd'hui, notes persistées. */}
      {due.totalDue > 0 && !loading && (
        <button
          type="button"
          onClick={() => setReviewing(true)}
          className="mt-5 flex w-full items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-left transition-colors hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/15"
        >
          <span className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden>
              🧠
            </span>
            <span>
              <span className="block text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                {t.vocab.reviewTitle}
              </span>
              <span className="block text-xs text-emerald-700/80 dark:text-emerald-400/80">
                {t.vocab.reviewDue({ count: due.totalDue })}
              </span>
            </span>
          </span>
          <span className="shrink-0 rounded-full bg-emerald-500 px-3.5 py-1.5 text-xs font-bold text-white">
            {t.vocab.reviewStart}
          </span>
        </button>
      )}

      {/* Révision par langue : mêmes exercices que le mode Cours, sans enjeu. */}
      {practicable.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {practicable.map(({ lang, items }) => (
            <button
              key={lang}
              type="button"
              onClick={() =>
                setPractice({
                  lang,
                  words: items.map((p) => ({ term: p.target, translation: p.meaning })),
                })
              }
              className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50/60 px-3.5 py-1.5 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/15"
            >
              <span aria-hidden>{LANG_FLAG[lang as LangCode] ?? "🌐"}</span>
              {t.vocab.practice} · {LANG_LABEL[lang as LangCode] ?? lang}
              <span className="text-xs tabular-nums opacity-70">{items.length}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">…</p>
      ) : list.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">
          {t.vocab.empty}
        </p>
      ) : (
        <ul className="mt-6 space-y-1">
          {list.map((e) => {
            const f = foreignSide(e);
            return (
              <li
                key={e.id}
                className="flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                {canSpeak && (
                  <button
                    type="button"
                    onClick={() => speak(f.text, f.lang)}
                    aria-label={t.learn.listen}
                    className="shrink-0 rounded-lg p-1.5 text-sky-500 transition-colors hover:bg-sky-50 dark:hover:bg-sky-500/10"
                  >
                    <Volume2 className="size-4" aria-hidden />
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">
                    {e.term}
                  </p>
                  <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">
                    {e.translation}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                  {e.source_lang} → {e.target_lang}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(e.id)}
                  aria-label={t.vocab.delete}
                  className="shrink-0 rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-red-600 dark:hover:bg-neutral-800 dark:hover:text-red-400"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="size-4"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                    />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {practice && (
        <PracticePlayer
          targetLang={practice.lang}
          words={practice.words}
          onClose={() => setPractice(null)}
        />
      )}

      {reviewing && (
        <ReviewPlayer
          entries={due.entries}
          onClose={() => {
            setReviewing(false);
            refreshDue();
          }}
        />
      )}
    </main>
  );
}
