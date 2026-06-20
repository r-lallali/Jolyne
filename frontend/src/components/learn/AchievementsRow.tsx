"use client";

import { useT } from "@/lib/i18n";

// Catalogue des succès, dans l'ordre d'affichage. Les codes correspondent à
// ceux définis côté backend (internal/learn/model.go) et aux clés i18n
// t.learn.ach.*. L'emoji est purement décoratif.
const CATALOG: { code: AchCode; icon: string }[] = [
  { code: "first_lesson", icon: "🎯" },
  { code: "lessons_10", icon: "📚" },
  { code: "lessons_50", icon: "🏆" },
  { code: "xp_100", icon: "⚡" },
  { code: "xp_500", icon: "💪" },
  { code: "xp_1000", icon: "🌟" },
  { code: "streak_3", icon: "🔥" },
  { code: "streak_7", icon: "🔥" },
  { code: "streak_30", icon: "👑" },
];

type AchCode =
  | "first_lesson"
  | "lessons_10"
  | "lessons_50"
  | "xp_100"
  | "xp_500"
  | "xp_1000"
  | "streak_3"
  | "streak_7"
  | "streak_30";

export function AchievementsRow({ unlocked }: { unlocked: string[] }) {
  const t = useT();
  const have = new Set(unlocked);
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        {t.learn.achievements}
      </h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
        {CATALOG.map(({ code, icon }) => {
          const got = have.has(code);
          return (
            <div
              key={code}
              className={
                "group flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-0.5 " +
                (got
                  ? "border-amber-300/80 bg-amber-50 hover:shadow-[0_8px_24px_-14px_rgba(217,119,6,0.5)] dark:border-amber-500/40 dark:bg-amber-500/10"
                  : "border-neutral-200 bg-neutral-50 opacity-60 hover:opacity-100 dark:border-neutral-800 dark:bg-neutral-900")
              }
              title={t.learn.ach[code]}
            >
              <span
                className={
                  "text-2xl transition-transform duration-300 ease-out group-hover:scale-110 " +
                  (got ? "" : "grayscale")
                }
              >
                {icon}
              </span>
              <span className="text-[11px] font-medium leading-tight text-neutral-600 dark:text-neutral-400">
                {t.learn.ach[code]}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
