"use client";

import { useEffect, useRef, useState } from "react";
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
// t.learn.ach.* (nom) et t.learn.achDesc.* (comment débloquer). L'icône lucide
// est purement décorative.
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
  // Code du succès dont la bulle explicative est ouverte (un seul à la fois).
  const [open, setOpen] = useState<AchCode | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Fermeture au clic en dehors ou sur Échap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <section className="mt-8" ref={rootRef}>
      <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        {t.learn.achievements}
      </h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
        {CATALOG.map(({ code, icon: Icon }, i) => {
          const got = have.has(code);
          const isOpen = open === code;
          // Alignement de la bulle selon la colonne pour éviter le débordement.
          const col = i % 3;
          return (
            <div key={code} className="relative">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : code)}
                aria-expanded={isOpen}
                className={cn(
                  "group flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-0.5",
                  got
                    ? "border-amber-300/80 bg-amber-50 hover:shadow-[0_8px_24px_-14px_rgba(217,119,6,0.5)] dark:border-amber-500/40 dark:bg-amber-500/10"
                    : "border-neutral-200 bg-neutral-50 opacity-60 hover:opacity-100 dark:border-neutral-800 dark:bg-neutral-900",
                  isOpen &&
                    "ring-2 ring-amber-400/60 ring-offset-1 ring-offset-white dark:ring-offset-neutral-950",
                )}
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
              </button>

              {isOpen && (
                <div
                  role="tooltip"
                  className={cn(
                    "absolute top-full z-20 mt-2 w-max max-w-[12rem] rounded-xl border border-neutral-200 bg-white p-3 text-start shadow-lg dark:border-neutral-700 dark:bg-neutral-900",
                    col === 0 && "left-0",
                    col === 1 && "left-1/2 -translate-x-1/2",
                    col === 2 && "right-0",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -top-1.5 h-3 w-3 rotate-45 border-l border-t border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900",
                      col === 0 && "left-4",
                      col === 1 && "left-1/2 -translate-x-1/2",
                      col === 2 && "right-4",
                    )}
                  />
                  <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-100">
                    {t.learn.ach[code]}
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-neutral-600 dark:text-neutral-400">
                    {t.learn.achDesc[code]}
                  </p>
                  <span
                    className={cn(
                      "mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
                      got
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                        : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
                    )}
                  >
                    {got ? t.learn.achDone : t.learn.achLocked}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
