"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { AchievementsRow } from "@/components/learn/AchievementsRow";
import { CoursePath } from "@/components/learn/CoursePath";
import { HeartRequestsBanner } from "@/components/learn/HeartRequestsBanner";
import { LearnHeader } from "@/components/learn/LearnHeader";
import { LessonPlayer, type LessonWord } from "@/components/learn/LessonPlayer";
import { PracticePlayer } from "@/components/learn/PracticePlayer";
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
import { listVocab, practiceItems, type VocabEntry } from "@/lib/vocab";
import { useUserStore } from "@/stores/userStore";

// Seuil d'entrées du carnet (pour la paire de langues du cours) à partir
// duquel la révision est proposée — en deçà, pas assez de distracteurs.
const PRACTICE_MIN_WORDS = 4;

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
  // Carnet de vocabulaire : alimente la révision libre du cours ouvert.
  const [vocabEntries, setVocabEntries] = useState<VocabEntry[]>([]);
  const [practice, setPractice] = useState<LessonWord[] | null>(null);

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
  // Carnet best-effort : la révision est simplement absente si l'appel échoue.
  const refreshVocab = useCallback(
    () => listVocab().then(setVocabEntries).catch(() => {}),
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
    void refreshVocab();
  }, [hydrated, user, refreshVocab]);

  const refreshCourse = useCallback(async () => {
    if (!lang) return;
    try {
      const [tr, st] = await Promise.all([getCourseTree(lang), getState()]);
      setTree(tr);
      setState(st);
    } catch {
      /* silencieux */
    }
    // Des mots ont pu être ajoutés au carnet pendant la leçon.
    void refreshVocab();
  }, [lang, refreshVocab]);

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
    // La progression affichée sur les cartes de cours a pu évoluer.
    listCourses().then(setCourses).catch(() => {});
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
          {loading ? (
            <p className="mt-7 text-sm text-neutral-500 dark:text-neutral-400">…</p>
          ) : courses.length === 0 ? (
            <p className="mt-7 text-sm text-neutral-500 dark:text-neutral-400">
              {t.learn.empty}
            </p>
          ) : (
            (() => {
              // « Reprendre » : cours entamés en premier, avec progression.
              const enrolled = courses.filter((c) => c.enrolled);
              const others = courses.filter((c) => !c.enrolled);
              return (
                <>
                  {enrolled.length > 0 && (
                    <>
                      <h2 className="mb-3 mt-7 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                        {t.learn.yourCourses}
                      </h2>
                      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {enrolled.map((c) => (
                          <li key={c.lang}>
                            <CourseCard course={c} withProgress onOpen={openCourse} />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {others.length > 0 && (
                    <>
                      <h2 className="mb-3 mt-7 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                        {enrolled.length > 0 ? t.learn.allCourses : t.learn.chooseCourse}
                      </h2>
                      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {others.map((c) => (
                          <li key={c.lang}>
                            <CourseCard course={c} onOpen={openCourse} />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              );
            })()
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
            (() => {
              // Révision libre : mots du carnet appartenant à la langue du cours.
              const words = practiceItems(vocabEntries, tree.lang).map((p) => ({
                term: p.target,
                translation: p.meaning,
              }));
              return (
                <div className="mt-6 space-y-6">
                  {words.length >= PRACTICE_MIN_WORDS && (
                    <button
                      type="button"
                      onClick={() => setPractice(words)}
                      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50/60 px-4 py-3 text-left transition-colors hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/10 dark:hover:bg-sky-500/15"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <BookOpen className="size-4 shrink-0 text-sky-500" aria-hidden />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-sky-700 dark:text-sky-300">
                            {t.learn.practice}
                          </span>
                          <span className="block truncate text-xs text-sky-600/70 dark:text-sky-300/60">
                            {t.learn.practiceNote}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-medium tabular-nums text-sky-600/80 dark:text-sky-300/70">
                        {t.vocab.count({ count: words.length })}
                      </span>
                    </button>
                  )}
                  <CoursePath
                    tree={tree}
                    onStart={startLesson}
                    scriptName={scriptName}
                    onDiagnostic={
                      sampleScriptLessonId ? () => setDiagnostic(true) : undefined
                    }
                  />
                </div>
              );
            })()
          )}
        </>
      )}

      {practice && lang && (
        <PracticePlayer
          targetLang={lang}
          words={practice}
          onClose={() => setPractice(null)}
        />
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

// Carte d'un cours dans la liste. `withProgress` remplace le compte de leçons
// par une barre d'avancement (cours entamés de la section « reprendre »).
function CourseCard({
  course,
  withProgress,
  onOpen,
}: {
  course: CourseSummary;
  withProgress?: boolean;
  onOpen: (lang: string) => void;
}) {
  const t = useT();
  const cl = course.lang as LangCode;
  const pct = course.lesson_count
    ? Math.round((100 * course.completed_lessons) / course.lesson_count)
    : 0;
  return (
    <button
      type="button"
      onClick={() => onOpen(course.lang)}
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
          {LANG_LABEL[cl] ?? course.title}
        </span>
        {withProgress ? (
          <span className="mt-1.5 flex items-center gap-2">
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <span
                className="block h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="shrink-0 text-[10px] font-medium tabular-nums text-neutral-400 dark:text-neutral-500">
              {t.learn.progressLessons({
                done: course.completed_lessons,
                total: course.lesson_count,
              })}
            </span>
          </span>
        ) : (
          <span className="mt-0.5 block text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
            {t.learn.lessonsCount({ count: course.lesson_count })}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="-translate-x-1 text-xs font-medium text-neutral-400 opacity-0 transition-all duration-300 ease-out group-hover:translate-x-0 group-hover:opacity-100 dark:text-neutral-500">
          {withProgress ? t.learn.continueLesson : t.learn.courseCta}
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
  );
}
