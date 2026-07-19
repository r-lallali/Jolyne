"use client";

import { EyeIcon, EyeOffIcon } from "@/components/auth/icons";

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
