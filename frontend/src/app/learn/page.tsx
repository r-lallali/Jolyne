"use client";

import Link from "next/link";
import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import { AchievementsRow } from "@/components/learn/AchievementsRow";
import { LearnHeader } from "@/components/learn/LearnHeader";
import { BackButton } from "@/components/ui/BackButton";
import { useT } from "@/lib/i18n";
import { LANG_FLAG, LANG_LABEL, type LangCode } from "@/lib/langs";
import {
  getState,
  listCourses,
  type CourseSummary,
  type LearnState,
} from "@/lib/learn";
import { useUserStore } from "@/stores/userStore";

export default function LearnHomePage() {
  const t = useT();
  const user = useUserStore((s) => s.user);
  const hydrated = useUserStore((s) => s.hydrated);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [state, setState] = useState<LearnState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hydrated || !user) return;
    Promise.all([listCourses(), getState()])
      .then(([cs, st]) => {
        setCourses(cs);
        setState(st);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [hydrated, user]);

  if (!hydrated) return null;
  if (!user) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 pb-16 pt-[calc(env(safe-area-inset-top)+3.5rem)] sm:pt-10">
      <BackButton href="/" label={t.auth.backToApp} />

      <h1 className="mt-4 text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
        {t.learn.title}
      </h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        {t.learn.subtitle}
      </p>

      {state && (
        <div className="mt-5">
          <LearnHeader state={state} />
        </div>
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        {t.learn.chooseCourse}
      </h2>

      {loading ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">…</p>
      ) : courses.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t.learn.empty}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {courses.map((c) => {
            const lang = c.lang as LangCode;
            return (
              <li key={c.lang}>
                <Link
                  href={`/learn/${c.lang}`}
                  className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 transition-colors hover:border-emerald-400 hover:bg-emerald-50/40 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-emerald-500/50 dark:hover:bg-emerald-500/5"
                >
                  <span className="text-3xl" aria-hidden>
                    {LANG_FLAG[lang] ?? "🌐"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-neutral-900 dark:text-neutral-50">
                      {LANG_LABEL[lang] ?? c.title}
                    </span>
                    <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                      {t.learn.lessonsCount({ count: c.lesson_count })}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white">
                    {t.learn.courseCta}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {state && <AchievementsRow unlocked={state.achievements} />}
    </main>
  );
}
