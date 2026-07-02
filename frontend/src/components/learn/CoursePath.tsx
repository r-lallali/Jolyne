"use client";

import { useT } from "@/lib/i18n";
import type { CourseTree, LessonNode } from "@/lib/learn";

// Parcours du cours : unités empilées, chaque leçon est un nœud cliquable.
// Décalage alterné gauche/droite pour évoquer un sentier (style Duolingo).
// Les unités d'écriture (kind "script") sont décorées (✍️) et ouvrent un
// diagnostic « je lis déjà ce script » tant qu'on n'y a pas progressé.
export function CoursePath({
  tree,
  onStart,
  scriptName,
  onDiagnostic,
}: {
  tree: CourseTree;
  onStart: (lesson: LessonNode) => void;
  // scriptName : nom du système d'écriture (pour le CTA de saut). Si absent ou
  // pas d'unité d'écriture, le diagnostic n'est pas proposé.
  scriptName?: string;
  onDiagnostic?: () => void;
}) {
  const t = useT();
  // Titre affiché dans la langue de l'apprenant (repli sur le titre stocké pour
  // les slugs hors curriculum : cours générés, unités d'écriture).
  const titleFor = (slug: string, fallback: string) =>
    t.learn.courseTitles[slug] ?? fallback;
  let globalIdx = 0;
  const firstUnit = tree.units[0];
  const showDiagnostic =
    !!onDiagnostic &&
    !!scriptName &&
    firstUnit?.kind === "script" &&
    !firstUnit.lessons.some((l) => l.completed || l.placed);
  return (
    <div className="space-y-10">
      {showDiagnostic && (
        <button
          type="button"
          onClick={onDiagnostic}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-sky-300 bg-sky-50/60 px-4 py-3 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300"
        >
          {t.learn.script.diagnosticCta({ script: scriptName! })}
          <span aria-hidden>→</span>
        </button>
      )}
      {tree.units.map((unit) => {
        const isScript = unit.kind === "script";
        const mastered = isScript && unit.lessons.every((l) => l.completed);
        return (
          <section key={unit.slug}>
            <div className="mb-4 rounded-2xl bg-neutral-900 px-4 py-3 text-neutral-50 dark:bg-neutral-100 dark:text-neutral-900">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider opacity-60">
                {isScript && <span aria-hidden>✍️</span>}
                {isScript ? t.learn.script.badge : t.learn.lessonsCount({ count: unit.lessons.length })}
                {mastered && <span className="text-emerald-400">· {t.learn.script.unitMastered}</span>}
              </p>
              <h2 className="text-lg font-bold">{titleFor(unit.slug, unit.title)}</h2>
            </div>
            <div className="flex flex-col items-center gap-5">
              {unit.lessons.map((lesson) => {
                const offset = ["", "translate-x-12", "", "-translate-x-12"][globalIdx % 4];
                globalIdx += 1;
                return (
                  <div key={lesson.id} className={`flex flex-col items-center ${offset}`}>
                    <LessonBubble lesson={lesson} onStart={onStart} />
                    <p className="mt-1.5 max-w-[8rem] text-center text-xs font-medium text-neutral-600 dark:text-neutral-400">
                      {titleFor(lesson.slug, lesson.title)}
                    </p>
                    {lesson.completed && !lesson.placed && <Stars count={lesson.stars} />}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function LessonBubble({
  lesson,
  onStart,
}: {
  lesson: LessonNode;
  onStart: (lesson: LessonNode) => void;
}) {
  const t = useT();
  const label = t.learn.courseTitles[lesson.slug] ?? lesson.title;
  const base =
    "flex size-16 items-center justify-center rounded-full text-2xl shadow-md transition-transform active:scale-95";
  if (lesson.locked) {
    return (
      <button
        type="button"
        disabled
        title={t.learn.lockedHint}
        aria-label={`${label} — ${t.learn.locked}`}
        className={`${base} cursor-not-allowed bg-neutral-200 text-neutral-400 shadow-none dark:bg-neutral-800 dark:text-neutral-600`}
      >
        🔒
      </button>
    );
  }
  // Placée (acquise via le niveau choisi) : aspect neutre « ✓ ». Jouée :
  // doré « ★ ». À jouer : vert mis en avant « ▶ ».
  const style = lesson.placed
    ? "bg-sky-100 text-sky-600 hover:scale-105 dark:bg-sky-500/15 dark:text-sky-300"
    : lesson.completed
      ? "bg-amber-400 text-amber-950 hover:scale-105"
      : "bg-emerald-500 text-white ring-4 ring-emerald-500/25 hover:scale-105";
  // Leçon d'écriture à jouer : pinceau plutôt que ▶ pour la distinguer.
  const idle = lesson.kind === "script" ? "✍️" : "▶";
  return (
    <button
      type="button"
      onClick={() => onStart(lesson)}
      aria-label={`${label} — ${lesson.completed ? t.learn.review : t.learn.start}`}
      className={`${base} ${style}`}
    >
      {lesson.placed ? "✓" : lesson.completed ? "★" : idle}
    </button>
  );
}

function Stars({ count }: { count: number }) {
  return (
    <div className="mt-0.5 flex gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={
            i < count ? "text-xs text-amber-400" : "text-xs text-neutral-300 dark:text-neutral-700"
          }
        >
          ★
        </span>
      ))}
    </div>
  );
}
