"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AchievementsRow } from "@/components/learn/AchievementsRow";
import { CoursePath } from "@/components/learn/CoursePath";
import { HeartRequestsBanner } from "@/components/learn/HeartRequestsBanner";
import { LearnHeader } from "@/components/learn/LearnHeader";
import { LessonPlayer } from "@/components/learn/LessonPlayer";
import { LevelChooser } from "@/components/learn/LevelChooser";
import { OutOfHearts } from "@/components/learn/OutOfHearts";
import { useT, useUILang } from "@/lib/i18n";
import { LANG_FLAG, LANG_LABEL, type LangCode } from "@/lib/langs";
import {
  enrollCourse,
  getCourseTree,
  getLesson,
  getState,
  listCourses,
  type CourseSummary,
  type CourseTree,
  type LearnState,
  type LessonNode,
  type PlayItem,
} from "@/lib/learn";
import { useUserStore } from "@/stores/userStore";

interface ActiveLesson {
  id: number;
  title: string;
  items: PlayItem[];
}

// LearnMode : orchestrateur du mode Cours, rendu comme 3e onglet de la home
// (et via la route /learn). Navigation interne par état (pas de routing) :
// liste des cours → parcours d'un cours → lecteur de leçon (overlay).
export function LearnMode() {
  const t = useT();
  const from = useUILang();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const hydrated = useUserStore((s) => s.hydrated);

  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [state, setState] = useState<LearnState | null>(null);
  const [lang, setLang] = useState<string | null>(null);
  const [tree, setTree] = useState<CourseTree | null>(null);
  const [active, setActive] = useState<ActiveLesson | null>(null);
  const [outOfHearts, setOutOfHearts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refreshState = useCallback(
    () => getState().then(setState).catch(() => {}),
    [],
  );

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

  const refreshCourse = useCallback(async () => {
    if (!lang) return;
    try {
      const [tr, st] = await Promise.all([getCourseTree(lang), getState()]);
      setTree(tr);
      setState(st);
    } catch {
      /* silencieux */
    }
  }, [lang]);

  const openCourse = async (l: string) => {
    setLang(l);
    setTree(null);
    try {
      const [tr, st] = await Promise.all([getCourseTree(l), getState()]);
      setTree(tr);
      setState(st);
    } catch {
      /* silencieux */
    }
  };

  const backToList = () => {
    setLang(null);
    setTree(null);
    void refreshState();
  };

  const choose = async (startUnit: number) => {
    if (!lang || busy) return;
    setBusy(true);
    try {
      setTree(await enrollCourse(lang, startUnit));
    } catch {
      /* silencieux */
    } finally {
      setBusy(false);
    }
  };

  const startLesson = async (lesson: LessonNode) => {
    if (busy) return;
    // Plus de vies (hors premium) → écran dédié, on ne lance pas.
    if (state && !state.premium && state.hearts <= 0) {
      setOutOfHearts(true);
      return;
    }
    setBusy(true);
    try {
      const lp = await getLesson(lesson.id, from);
      setActive({ id: lp.id, title: lp.title, items: lp.items });
    } catch {
      /* silencieux */
    } finally {
      setBusy(false);
    }
  };

  if (!hydrated || !user) return null;

  return (
    <div className="w-full max-w-2xl px-6 pb-24 pt-[calc(env(safe-area-inset-top)+3.25rem)] sm:pt-16">
      {state && state.incoming_heart_requests > 0 && (
        <HeartRequestsBanner onChanged={refreshState} />
      )}
      {state && <LearnHeader state={state} />}

      {!lang ? (
        <>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            {t.learn.title}
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {t.learn.subtitle}
          </p>
          <h2 className="mb-3 mt-7 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            {t.learn.chooseCourse}
          </h2>
          {loading ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">…</p>
          ) : courses.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {t.learn.empty}
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {courses.map((c) => {
                const cl = c.lang as LangCode;
                return (
                  <li key={c.lang}>
                    <button
                      type="button"
                      onClick={() => openCourse(c.lang)}
                      className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 text-left transition-colors hover:border-emerald-400 hover:bg-emerald-50/40 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-emerald-500/50 dark:hover:bg-emerald-500/5"
                    >
                      <span className="text-3xl" aria-hidden>
                        {LANG_FLAG[cl] ?? "🌐"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-neutral-900 dark:text-neutral-50">
                          {LANG_LABEL[cl] ?? c.title}
                        </span>
                        <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                          {t.learn.lessonsCount({ count: c.lesson_count })}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white">
                        {t.learn.courseCta}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {state && <AchievementsRow unlocked={state.achievements} />}
        </>
      ) : !tree ? (
        <p className="mt-10 text-center text-sm text-neutral-500 dark:text-neutral-400">…</p>
      ) : (
        <>
          <button
            type="button"
            onClick={backToList}
            className="mt-4 text-sm font-medium text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            ← {t.learn.backToCourses}
          </button>
          {!tree.enrolled ? (
            <LevelChooser
              unitCount={tree.unit_count}
              busy={busy}
              onChoose={choose}
            />
          ) : (
            <div className="mt-6">
              <CoursePath tree={tree} onStart={startLesson} />
            </div>
          )}
        </>
      )}

      {active && state && lang && (
        <LessonPlayer
          lessonId={active.id}
          targetLang={lang}
          title={active.title}
          items={active.items}
          initialHearts={state.hearts}
          premium={state.premium}
          onClose={(completed) => {
            setActive(null);
            if (completed) void refreshCourse();
          }}
          onOutOfHearts={() => {
            setActive(null);
            setOutOfHearts(true);
            void refreshCourse();
          }}
        />
      )}

      {outOfHearts && state && (
        <OutOfHearts
          state={state}
          onClose={() => setOutOfHearts(false)}
          onGoPremium={() => router.push("/premium")}
          onChanged={() => {
            setOutOfHearts(false);
            void refreshCourse();
          }}
        />
      )}
    </div>
  );
}
