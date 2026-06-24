"use client";

import {
  BookOpen,
  Crown,
  Dumbbell,
  Flame,
  Sparkles,
  Target,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

// Catalogue des succès, dans l'ordre d'affichage. Les codes correspondent à
// ceux définis côté backend (internal/learn/model.go) et aux clés i18n
// t.learn.ach.*. L'icône lucide est purement décorative.
const CATALOG: { code: AchCode; icon: LucideIcon }[] = [
  { code: "first_lesson", icon: Target },
  { code: "lessons_10", icon: BookOpen },
  { code: "lessons_50", icon: Trophy },
  { code: "xp_100", icon: Zap },
  { code: "xp_500", icon: Dumbbell },
  { code: "xp_1000", icon: Sparkles },
  { code: "streak_3", icon: Flame },
  { code: "streak_7", icon: Flame },
  { code: "streak_30", icon: Crown },
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
        {CATALOG.map(({ code, icon: Icon }) => {
          const got = have.has(code);
          return (
            <div
              key={code}
              className={cn(
                "group flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-0.5",
                got
                  ? "border-amber-300/80 bg-amber-50 hover:shadow-[0_8px_24px_-14px_rgba(217,119,6,0.5)] dark:border-amber-500/40 dark:bg-amber-500/10"
                  : "border-neutral-200 bg-neutral-50 opacity-60 hover:opacity-100 dark:border-neutral-800 dark:bg-neutral-900",
              )}
              title={t.learn.ach[code]}
            >
              <Icon
                size={22}
                strokeWidth={2}
                className={cn(
                  "transition-transform duration-300 ease-out group-hover:scale-110",
                  got
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-neutral-400 dark:text-neutral-500",
                )}
              />
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
