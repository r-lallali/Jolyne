"use client";

import { useT } from "@/lib/i18n";
import type { LearnState } from "@/lib/learn";

// Bandeau de gamification : série (streak), cœurs, XP total et anneau
// d'objectif quotidien. Affiché en haut du parcours et de la sélection.
export function LearnHeader({ state }: { state: LearnState }) {
  const t = useT();
  const goalPct =
    state.daily_goal > 0
      ? Math.min(1, state.daily_xp / state.daily_goal)
      : 0;

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white/70 px-4 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/60">
      {/* Série */}
      <Stat
        title={t.learn.streak}
        value={state.current_streak}
        accent={state.current_streak > 0}
        icon={
          <span className={state.streak_at_risk ? "animate-pulse" : ""}>🔥</span>
        }
      />
      {/* Cœurs */}
      <div className="flex flex-col items-center gap-0.5">
        <div className="flex items-center gap-0.5" aria-label={t.learn.hearts}>
          {Array.from({ length: state.max_hearts }).map((_, i) => (
            <span
              key={i}
              className={
                i < state.hearts
                  ? "text-sm"
                  : "text-sm opacity-25 grayscale"
              }
            >
              ❤️
            </span>
          ))}
        </div>
        <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
          {t.learn.hearts}
        </span>
      </div>
      {/* XP total */}
      <Stat title="XP" value={state.total_xp} accent icon={<span>⚡</span>} />
      {/* Anneau objectif quotidien */}
      <div
        className="flex flex-col items-center gap-0.5"
        title={t.learn.goalProgress({
          xp: state.daily_xp,
          goal: state.daily_goal,
        })}
      >
        <GoalRing pct={goalPct} reached={goalPct >= 1} />
        <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
          {t.learn.dailyGoal}
        </span>
      </div>
    </div>
  );
}

function Stat({
  title,
  value,
  icon,
  accent,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="flex items-center gap-1 text-sm font-bold tabular-nums">
        {icon}
        <span
          className={
            accent
              ? "text-neutral-900 dark:text-neutral-50"
              : "text-neutral-400 dark:text-neutral-500"
          }
        >
          {value}
        </span>
      </span>
      <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
        {title}
      </span>
    </div>
  );
}

function GoalRing({ pct, reached }: { pct: number; reached: boolean }) {
  const r = 11;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 28 28" className="size-7">
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        strokeWidth="3"
        className="stroke-neutral-200 dark:stroke-neutral-700"
      />
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform="rotate(-90 14 14)"
        className={
          reached
            ? "stroke-emerald-500 transition-all"
            : "stroke-amber-500 transition-all"
        }
      />
      {reached && (
        <text
          x="14"
          y="18"
          textAnchor="middle"
          className="fill-emerald-500 text-[11px] font-bold"
        >
          ✓
        </text>
      )}
    </svg>
  );
}
