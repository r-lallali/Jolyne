"use client";

import Link from "next/link";
import { PasswordField, TextInput } from "@/components/auth/AuthFields";
import { AppleIcon, GoogleIcon, MailIcon } from "@/components/auth/icons";
import type { OAuthProvider } from "@/lib/auth";
import type { Messages } from "@/lib/i18n";

// Vues de la feuille d'auth (LoginSheet est la coquille : état + transitions).

export type EmailMode = "login" | "signup";

// Vue d'entrée : promesse produit + Google / Apple en tête, e-mail en
// chemin secondaire, mention légale discrète.
export function Landing({
  t,
  providers,
  busy,
  onOAuth,
  onEmail,
}: {
  t: Messages;
  providers: OAuthProvider[];
  busy: boolean;
  onOAuth: (p: OAuthProvider) => void;
  onEmail: () => void;
}) {
  return (
    <div className="pt-3">
      <div className="mb-6 text-center">
        <p className="text-3xl" aria-hidden>
          👋
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
          {t.auth.welcomeTitle}
        </h2>
        <p className="mx-auto mt-1.5 max-w-[19rem] text-sm text-neutral-500 dark:text-neutral-400">
          {t.auth.welcomeHint}
        </p>
      </div>

      <div className="space-y-2.5">
        {providers.includes("google") && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onOAuth("google")}
            className="flex h-12 w-full items-center justify-center gap-2.5 rounded-2xl border border-neutral-200 bg-white text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-30 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            <GoogleIcon />
            {t.auth.continueWithGoogle}
          </button>
        )}
        {providers.includes("apple") && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onOAuth("apple")}
            className="flex h-12 w-full items-center justify-center gap-2.5 rounded-2xl bg-neutral-900 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-white dark:text-neutral-900"
          >
            <AppleIcon />
            {t.auth.continueWithApple}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onEmail}
          className="flex h-12 w-full items-center justify-center gap-2.5 rounded-2xl bg-neutral-100 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <MailIcon />
          {t.auth.continueWithEmail}
        </button>
      </div>

      <p className="mt-5 text-center text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-500">
        <Link href="/legal" className="underline-offset-2 hover:underline">
          {t.auth.termsNotice}
        </Link>
      </p>
    </div>
  );
}

// Vue e-mail : login ou signup, bascule par lien sous le CTA.
export function EmailForm({
  t,
  mode,
  busy,
  err,
  fields,
  set,
  onSwitchMode,
  onForgot,
}: {
  t: Messages;
  mode: EmailMode;
  busy: boolean;
  err: string | null;
  fields: {
    email: string;
    displayName: string;
    password: string;
    passwordConfirm: string;
    showPwd: boolean;
  };
  set: {
    setEmail: (v: string) => void;
    setDisplayName: (v: string) => void;
    setPassword: (v: string) => void;
    setPasswordConfirm: (v: string) => void;
    setShowPwd: (f: (v: boolean) => boolean) => void;
  };
  onSwitchMode: (m: EmailMode) => void;
  onForgot: () => void;
}) {
  const login = mode === "login";
  return (
    <div className="pt-3">
      <div className="mb-5 text-center">
        <h2 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
          {login ? t.auth.loginTitle : t.auth.signupTitle}
        </h2>
        <p className="mx-auto mt-1.5 max-w-[19rem] text-sm text-neutral-500 dark:text-neutral-400">
          {login ? t.auth.loginHint : t.auth.signupHint}
        </p>
      </div>

      <div className="space-y-2.5">
        <TextInput
          type="email"
          value={fields.email}
          onChange={set.setEmail}
          placeholder={t.auth.emailPlaceholder}
          autoComplete="email"
          autoFocus
        />
        {!login && (
          <TextInput
            type="text"
            value={fields.displayName}
            onChange={(v) => set.setDisplayName(v.slice(0, 40))}
            placeholder={t.auth.displayNamePlaceholder}
            autoComplete="nickname"
          />
        )}
        <PasswordField
          value={fields.password}
          onChange={set.setPassword}
          placeholder={t.auth.passwordPlaceholder}
          visible={fields.showPwd}
          onToggle={() => set.setShowPwd((v) => !v)}
          autoComplete={login ? "current-password" : "new-password"}
          showLabel={t.auth.showPassword}
          hideLabel={t.auth.hidePassword}
        />
        {!login && (
          <PasswordField
            value={fields.passwordConfirm}
            onChange={set.setPasswordConfirm}
            placeholder={t.auth.passwordConfirmPlaceholder}
            visible={fields.showPwd}
            onToggle={() => set.setShowPwd((v) => !v)}
            autoComplete="new-password"
            showLabel={t.auth.showPassword}
            hideLabel={t.auth.hidePassword}
          />
        )}
      </div>

      {err && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {err}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 h-12 w-full rounded-2xl bg-neutral-900 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-neutral-50 dark:text-neutral-900"
      >
        {busy ? "…" : login ? t.auth.submitLogin : t.auth.submitSignup}
      </button>

      <div className="mt-4 space-y-1.5 text-center text-xs text-neutral-500 dark:text-neutral-400">
        <p>
          {login ? t.auth.noAccount : t.auth.haveAccount}{" "}
          <button
            type="button"
            onClick={() => onSwitchMode(login ? "signup" : "login")}
            className="font-semibold text-neutral-900 underline-offset-2 hover:underline dark:text-neutral-100"
          >
            {login ? t.auth.tabSignup : t.auth.tabLogin}
          </button>
        </p>
        {login && (
          <button
            type="button"
            onClick={onForgot}
            className="underline-offset-2 hover:underline"
          >
            {t.auth.tabForgot}
          </button>
        )}
      </div>
    </div>
  );
}

// Vue reset : demande d'e-mail puis confirmation d'envoi.
export function Forgot({
  t,
  sent,
  busy,
  err,
  email,
  setEmail,
  onDone,
}: {
  t: Messages;
  sent: boolean;
  busy: boolean;
  err: string | null;
  email: string;
  setEmail: (v: string) => void;
  onDone: () => void;
}) {
  if (sent) {
    return (
      <div className="py-6 text-center">
        <div className="mx-auto mb-3 inline-flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <MailIcon />
        </div>
        <p className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
          {t.auth.emailSent}
        </p>
        <p className="mx-auto mt-1.5 max-w-[18rem] text-sm text-neutral-500 dark:text-neutral-400">
          {t.auth.emailSentHint}
        </p>
        <button
          type="button"
          onClick={onDone}
          className="mt-6 h-12 w-full rounded-2xl bg-neutral-900 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
        >
          {t.common.close}
        </button>
      </div>
    );
  }
  return (
    <div className="pt-3">
      <div className="mb-5 text-center">
        <h2 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
          {t.auth.forgotTitle}
        </h2>
        <p className="mx-auto mt-1.5 max-w-[19rem] text-sm text-neutral-500 dark:text-neutral-400">
          {t.auth.forgotHint}
        </p>
      </div>
      <TextInput
        type="email"
        value={email}
        onChange={setEmail}
        placeholder={t.auth.emailPlaceholder}
        autoComplete="email"
        autoFocus
      />
      {err && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {err}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="mt-5 h-12 w-full rounded-2xl bg-neutral-900 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-neutral-50 dark:text-neutral-900"
      >
        {busy ? "…" : t.auth.submitForgot}
      </button>
    </div>
  );
}
