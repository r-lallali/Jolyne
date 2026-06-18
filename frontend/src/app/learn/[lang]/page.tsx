"use client";

import { notFound, useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CoursePath } from "@/components/learn/CoursePath";
import { LearnHeader } from "@/components/learn/LearnHeader";
import { LessonPlayer } from "@/components/learn/LessonPlayer";
import { BackButton } from "@/components/ui/BackButton";
import { useT, useUILang } from "@/lib/i18n";
import {
  getCourseTree,
  getLesson,
  getState,
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

export default function CoursePage() {
  const t = useT();
  const params = useParams<{ lang: string }>();
  const lang = params.lang;
  const from = useUILang();
  const user = useUserStore((s) => s.user);
  const hydrated = useUserStore((s) => s.hydrated);

  const [tree, setTree] = useState<CourseTree | null>(null);
  const [state, setState] = useState<LearnState | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<ActiveLesson | null>(null);
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(() => {
    return Promise.all([getCourseTree(lang), getState()])
      .then(([tr, st]) => {
        setTree(tr);
        setState(st);
      })
      .catch(() => setTree(null));
  }, [lang]);

  useEffect(() => {
    if (!hydrated || !user) return;
    refresh().finally(() => setLoading(false));
  }, [hydrated, user, refresh]);

  const startLesson = async (lesson: LessonNode) => {
    if (starting) return;
    setStarting(true);
    try {
      const lp = await getLesson(lesson.id, from);
      setActive({ id: lp.id, title: lp.title, items: lp.items });
    } catch {
      // silencieux : on laisse l'utilisateur réessayer
    } finally {
      setStarting(false);
    }
  };

  const closePlayer = (completed: boolean) => {
    setActive(null);
    if (completed) void refresh();
  };

  if (!hydrated) return null;
  if (!user) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 pb-20 pt-[calc(env(safe-area-inset-top)+3.5rem)] sm:pt-10">
      <BackButton href="/learn" label={t.learn.backToCourses} />

      {state && (
        <div className="mt-4">
          <LearnHeader state={state} />
        </div>
      )}

      {loading ? (
        <p className="mt-10 text-center text-sm text-neutral-500 dark:text-neutral-400">…</p>
      ) : !tree ? (
        <p className="mt-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
          {t.learn.empty}
        </p>
      ) : (
        <div className="mt-8">
          <CoursePath tree={tree} onStart={startLesson} />
        </div>
      )}

      {active && (
        <LessonPlayer
          lessonId={active.id}
          targetLang={lang}
          title={active.title}
          items={active.items}
          initialHearts={state?.hearts ?? 5}
          onClose={closePlayer}
        />
      )}
    </main>
  );
}
