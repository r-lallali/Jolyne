"use client";

import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import { BackButton } from "@/components/ui/BackButton";
import { useT } from "@/lib/i18n";
import { listVocab, deleteVocab, type VocabEntry } from "@/lib/vocab";
import { useUserStore } from "@/stores/userStore";

export default function VocabPage() {
  const t = useT();
  const user = useUserStore((s) => s.user);
  const hydrated = useUserStore((s) => s.hydrated);
  const [list, setList] = useState<VocabEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hydrated || !user) return;
    listVocab()
      .then(setList)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [hydrated, user]);

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

      {loading ? (
        <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">…</p>
      ) : list.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">
          {t.vocab.empty}
        </p>
      ) : (
        <ul className="mt-6 space-y-1">
          {list.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900"
            >
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
          ))}
        </ul>
      )}
    </main>
  );
}
