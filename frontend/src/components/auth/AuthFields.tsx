"use client";

import { EyeIcon, EyeOffIcon } from "@/components/auth/icons";
import type { Messages } from "@/lib/i18n";
import { checkPasswordCriterion, PASSWORD_CRITERIA } from "@/lib/password";

// Champs de formulaire partagés par les vues de la feuille d'auth.

export function TextInput({
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  autoFocus,
}: {
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      inputMode={type === "email" ? "email" : undefined}
      className="h-12 w-full rounded-2xl bg-neutral-100 px-4 text-base text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-50/20"
    />
  );
}

// Checklist des critères du mot de passe (signup / reset) : chaque ligne
// passe de rouge à vert dès que le critère est rempli. Le serveur rejoue
// les mêmes règles (règle d'or #3).
export function PasswordCriteria({
  t,
  password,
}: {
  t: Messages;
  password: string;
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-1 pt-1" aria-live="polite">
      {PASSWORD_CRITERIA.map((criterion) => {
        const ok = checkPasswordCriterion(criterion, password);
        return (
          <li
            key={criterion}
            className={
              "flex items-center gap-1.5 text-[11px] font-medium transition-colors duration-200 " +
              (ok
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-500 dark:text-red-400")
            }
          >
            <CriterionIcon ok={ok} />
            {t.auth.pwdCriteria[criterion]}
          </li>
        );
      })}
    </ul>
  );
}

function CriterionIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <svg
      className="size-3 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ) : (
    <svg
      className="size-3 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

// Input mot de passe avec œil intégré. Le toggle est partagé côté signup :
// si l'utilisateur veut voir ce qu'il tape, autant voir la confirmation.
export function PasswordField({
  value,
  onChange,
  placeholder,
  visible,
  onToggle,
  autoComplete,
  showLabel,
  hideLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  visible: boolean;
  onToggle: () => void;
  autoComplete: string;
  showLabel: string;
  hideLabel: string;
}) {
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-12 w-full rounded-2xl bg-neutral-100 px-4 pr-11 text-base text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-50/20"
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={visible ? hideLabel : showLabel}
        title={visible ? hideLabel : showLabel}
        className="absolute right-1.5 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
