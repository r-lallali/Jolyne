"use client";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

interface Props {
  value: boolean;
  onChange: (v: boolean) => void;
  // Quota prof IA épuisé (Free) : l'option est grisée et un tap ouvre le
  // paywall via onDisabledClick au lieu de cocher.
  disabled?: boolean;
  onDisabledClick?: () => void;
  // Messages prof IA restants aujourd'hui. null = ne pas afficher de compteur
  // (Premium, ou état pas encore chargé).
  remaining?: number | null;
}

// AiTeacherToggle : ligne-option dans la carte de setup. Cocher = tomber
// directement sur un prof IA (le backend reçoit ?bot=1 et court-circuite le
// matching humain). Toute la ligne est cliquable ; le switch à droite reflète
// l'état. Pour un Free, un compteur de messages restants s'affiche, et l'option
// est grisée (tap → paywall) une fois la limite atteinte.
export function AiTeacherToggle({
  value,
  onChange,
  disabled = false,
  onDisabledClick,
  remaining = null,
}: Props) {
  const t = useT();
  const showCounter = remaining !== null;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-disabled={disabled}
      onClick={() => (disabled ? onDisabledClick?.() : onChange(!value))}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors",
        disabled
          ? "cursor-pointer bg-neutral-100/60 dark:bg-neutral-900/40"
          : value
            ? "bg-neutral-200/70 dark:bg-neutral-800"
            : "bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-900/60 dark:hover:bg-neutral-800/70",
      )}
    >
      <span
        aria-hidden
        className={cn("text-xl leading-none", disabled && "grayscale")}
      >
        🤖
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm font-semibold",
            disabled
              ? "text-neutral-400 dark:text-neutral-600"
              : "text-neutral-900 dark:text-neutral-100",
          )}
        >
          {t.setup.aiTeacher}
        </span>
        <span
          className={cn(
            "block text-xs",
            disabled
              ? "text-amber-600 dark:text-amber-500"
              : "text-neutral-500 dark:text-neutral-400",
          )}
        >
          {disabled
            ? t.setup.aiTeacherExhausted
            : showCounter
              ? t.setup.aiTeacherRemaining({ count: remaining as number })
              : t.setup.aiTeacherHint}
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          value && !disabled
            ? "bg-emerald-500"
            : "bg-neutral-300 dark:bg-neutral-700",
        )}
      >
        <span
          className={cn(
            "inline-block size-5 rounded-full bg-white shadow-sm transition-transform",
            value && !disabled ? "translate-x-[1.375rem]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
