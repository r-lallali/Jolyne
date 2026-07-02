"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AchievementsRow } from "@/components/learn/AchievementsRow";
import { CoursePath } from "@/components/learn/CoursePath";
import { HeartRequestsBanner } from "@/components/learn/HeartRequestsBanner";
import { LearnHeader } from "@/components/learn/LearnHeader";
import { LessonPlayer } from "@/components/learn/LessonPlayer";
import { ScriptLessonPlayer } from "@/components/learn/ScriptLessonPlayer";
import { ScriptDiagnostic } from "@/components/learn/ScriptDiagnostic";
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
  // "script" ⇒ lecteur d'écriture ; sinon lecteur de vocabulaire.
  kind?: string;
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
  const [diagnostic, setDiagnostic] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Module d'écriture : unités "script" en tête de cours. Sert au diagnostic
  // de saut et à décorer le parcours.
  const scriptUnits = tree?.units.filter((u) => u.kind === "script") ?? [];
  const scriptName = lang
    ? (t.learn.script.names as Record<string, string>)[lang]
    : undefined;
  // Leçon représentative pour le diagnostic : la plus avancée du module (lecture).
  const sampleScriptLessonId =
    scriptUnits.at(-1)?.lessons.at(-1)?.id ?? scriptUnits[0]?.lessons[0]?.id;

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
      // Titre dans la langue de l'apprenant (repli sur le titre stocké).
      const title = t.learn.courseTitles[lesson.slug] ?? lp.title;
      setActive({ id: lp.id, title, items: lp.items, kind: lp.kind });
    } catch {
      /* silencieux */
    } finally {
      setBusy(false);
    }
  };

  // Diagnostic réussi : on saute tout le module d'écriture (placement à la 1re
  // unité de vocabulaire) puis on rafraîchit le parcours.
  const skipScript = async () => {
    setDiagnostic(false);
    if (!lang || scriptUnits.length === 0) return;
    try {
      setTree(await enrollCourse(lang, scriptUnits.length));
    } catch {
      /* silencieux */
    }
  };

  if (!hydrated || !user) return null;

  return (
    <div className="w-full max-w-2xl px-6 pb-24 pt-[calc(env(safe-area-inset-top)+4.25rem)] sm:pt-16">
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
                      className="group flex w-full items-center gap-4 rounded-2xl border border-neutral-200/80 bg-white px-4 py-3.5 text-left transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_10px_30px_-14px_rgba(0,0,0,0.25)] dark:border-neutral-800 dark:bg-neutral-900/70 dark:hover:border-neutral-700 dark:hover:shadow-[0_10px_30px_-14px_rgba(0,0,0,0.7)]"
                    >
                      <span
                        aria-hidden
                        className="grid size-11 shrink-0 place-items-center rounded-xl bg-neutral-100 text-2xl ring-1 ring-inset ring-neutral-200/70 transition-transform duration-300 ease-out group-hover:-rotate-6 group-hover:scale-110 dark:bg-neutral-800 dark:ring-neutral-700/60"
                      >
                        {LANG_FLAG[cl] ?? "🌐"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-neutral-900 dark:text-neutral-50">
                          {LANG_LABEL[cl] ?? c.title}
                        </span>
                        <span className="mt-0.5 block text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
                          {t.learn.lessonsCount({ count: c.lesson_count })}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="-translate-x-1 text-xs font-medium text-neutral-400 opacity-0 transition-all duration-300 ease-out group-hover:translate-x-0 group-hover:opacity-100 dark:text-neutral-500">
                          {t.learn.courseCta}
                        </span>
                        <span className="grid size-8 place-items-center rounded-full bg-neutral-100 text-neutral-500 transition-colors duration-300 ease-out group-hover:bg-neutral-900 group-hover:text-white dark:bg-neutral-800 dark:text-neutral-400 dark:group-hover:bg-neutral-100 dark:group-hover:text-neutral-900">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            aria-hidden
                            className="size-4 transition-transform duration-300 ease-out group-hover:translate-x-0.5"
                          >
                            <path
                              d="M5 12h14M13 6l6 6-6 6"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
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
              <CoursePath
                tree={tree}
                onStart={startLesson}
                scriptName={scriptName}
                onDiagnostic={
                  sampleScriptLessonId ? () => setDiagnostic(true) : undefined
                }
              />
            </div>
          )}
        </>
      )}

      {active &&
        state &&
        lang &&
        (() => {
          const Player = active.kind === "script" ? ScriptLessonPlayer : LessonPlayer;
          return (
            <Player
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
          );
        })()}

      {diagnostic && lang && scriptName && sampleScriptLessonId && (
        <ScriptDiagnostic
          sampleLessonId={sampleScriptLessonId}
          from={from}
          scriptName={scriptName}
          onPass={skipScript}
          onClose={() => setDiagnostic(false)}
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
