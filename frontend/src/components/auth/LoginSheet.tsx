"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { SheetHandle } from "@/components/ui/SheetHandle";
import {
  AuthError,
  forgotPassword,
  login as apiLogin,
  signup as apiSignup,
} from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useUserStore } from "@/stores/userStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = "login" | "signup" | "forgot";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;

// Bottom-sheet (mobile) / modal centrée (desktop) à onglets : Connexion /
// Inscription / Mot de passe oublié. Email + password en clair côté UI,
// hashé via bcrypt côté backend. Connexion immédiate après signup ou login.
export function LoginSheet({ open, onClose }: Props) {
  const t = useT();
  const setUser = useUserStore((s) => s.setUser);
  const [tab, setTab] = useState<Tab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTab("login");
      setEmail("");
      setPassword("");
      setPasswordConfirm("");
      setDisplayName("");
      setShowPwd(false);
      setSent(false);
      setBusy(false);
      setErr(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const switchTab = (next: Tab) => {
    setTab(next);
    setSent(false);
    setErr(null);
    setPassword("");
    setPasswordConfirm("");
    setShowPwd(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setErr(t.auth.invalidEmail);
      return;
    }
    if (tab !== "forgot" && password.length < PASSWORD_MIN) {
      setErr(t.auth.passwordTooShort);
      return;
    }
    if (tab === "signup" && password !== passwordConfirm) {
      setErr(t.auth.passwordMismatch);
      return;
    }
    setBusy(true);
    try {
      if (tab === "login") {
        const u = await apiLogin(trimmed, password);
        setUser(u);
        onClose();
      } else if (tab === "signup") {
        const u = await apiSignup(trimmed, password, displayName.trim());
        setUser(u);
        onClose();
      } else {
        await forgotPassword(trimmed);
        setSent(true);
      }
    } catch (e) {
      if (e instanceof AuthError) {
        if (tab === "login" && e.status === 401) setErr(t.auth.invalidCredentials);
        else if (tab === "signup" && e.status === 409) setErr(t.auth.emailAlreadyUsed);
        else setErr("Erreur");
      } else {
        setErr("Erreur");
      }
    } finally {
      setBusy(false);
    }
  };

  const title =
    tab === "login"
      ? t.auth.loginTitle
      : tab === "signup"
        ? t.auth.signupTitle
        : t.auth.forgotTitle;
  const hint =
    tab === "login"
      ? t.auth.loginHint
      : tab === "signup"
        ? t.auth.signupHint
        : t.auth.forgotHint;
  const cta =
    tab === "login"
      ? t.auth.submitLogin
      : tab === "signup"
        ? t.auth.submitSignup
        : t.auth.submitForgot;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <motion.form
        initial={{ opacity: 0, y: "100%" }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: "100%" }}
        transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="relative w-full max-w-sm rounded-t-3xl bg-white px-7 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-6 shadow-xl dark:bg-neutral-950 sm:rounded-3xl sm:pb-7"
      >
        <SheetHandle />
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
        >
          <CloseIcon />
        </button>

        {sent ? (
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
              onClick={onClose}
              className="mt-6 w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
            >
              {t.common.close}
            </button>
          </div>
        ) : (
          <>
            <div className="mb-5 mt-2 text-center">
              <h2 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
                {title}
              </h2>
              <p className="mx-auto mt-1.5 max-w-[20rem] text-sm text-neutral-500 dark:text-neutral-400">
                {hint}
              </p>
            </div>

            <div className="inline-flex w-full gap-1 rounded-full bg-neutral-100 p-1 dark:bg-neutral-900">
              <TabBtn active={tab === "login"} onClick={() => switchTab("login")}>
                {t.auth.tabLogin}
              </TabBtn>
              <TabBtn active={tab === "signup"} onClick={() => switchTab("signup")}>
                {t.auth.tabSignup}
              </TabBtn>
              <TabBtn active={tab === "forgot"} onClick={() => switchTab("forgot")}>
                {t.auth.tabForgot}
              </TabBtn>
            </div>

            <div className="mt-5 space-y-2.5">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.auth.emailPlaceholder}
                autoFocus
                autoComplete="email"
                inputMode="email"
                className="w-full rounded-xl bg-neutral-100 px-4 py-3 text-base text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-50/20"
              />
              {tab === "signup" && (
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value.slice(0, 40))}
                  placeholder={t.auth.displayNamePlaceholder}
                  autoComplete="nickname"
                  maxLength={40}
                  className="w-full rounded-xl bg-neutral-100 px-4 py-3 text-base text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-50/20"
                />
              )}
              {tab !== "forgot" && (
                <PasswordField
                  value={password}
                  onChange={setPassword}
                  placeholder={t.auth.passwordPlaceholder}
                  visible={showPwd}
                  onToggle={() => setShowPwd((v) => !v)}
                  autoComplete={
                    tab === "signup" ? "new-password" : "current-password"
                  }
                  showLabel={t.auth.showPassword}
                  hideLabel={t.auth.hidePassword}
                />
              )}
              {tab === "signup" && (
                <PasswordField
                  value={passwordConfirm}
                  onChange={setPasswordConfirm}
                  placeholder={t.auth.passwordConfirmPlaceholder}
                  visible={showPwd}
                  onToggle={() => setShowPwd((v) => !v)}
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
              className="mt-6 w-full rounded-xl bg-neutral-900 px-4 py-3.5 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-neutral-50 dark:text-neutral-900"
            >
              {busy ? "…" : cta}
            </button>
          </>
        )}
      </motion.form>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

// PasswordField : input mot de passe avec œil intégré à droite pour
// basculer visible/masqué. Le toggle est partagé (cliquer sur l'un montre
// les deux champs côté signup) — c'est le pattern attendu : si l'user veut
// voir ce qu'il tape, autant aussi voir ce qu'il confirme.
function PasswordField({
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
    <div className="relative mt-2">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full rounded-xl bg-neutral-100 px-4 py-3 pr-11 text-base text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-700"
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

function EyeIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-6 0-10-7-10-7a17.5 17.5 0 0 1 4.06-4.94" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c6 0 10 7 10 7a17.5 17.5 0 0 1-2.16 2.93" />
      <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
      <path d="M2 2l20 20" />
    </svg>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors " +
        (active
          ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-50"
          : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100")
      }
    >
      {children}
    </button>
  );
}
