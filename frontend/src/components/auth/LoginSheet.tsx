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
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <motion.form
        initial={{ opacity: 0, y: "100%" }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: "100%" }}
        transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-t-3xl bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-xl dark:bg-neutral-950 sm:rounded-2xl sm:pb-6"
      >
        <SheetHandle />

        {sent ? (
          <div className="py-4 text-center">
            <p className="text-base font-medium text-neutral-900 dark:text-neutral-50">
              {t.auth.emailSent}
            </p>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {t.auth.emailSentHint}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 w-full rounded-xl bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {t.common.close}
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
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

            <h2 className="mt-5 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
              {title}
            </h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {hint}
            </p>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.auth.emailPlaceholder}
              autoFocus
              autoComplete="email"
              inputMode="email"
              className="mt-4 w-full rounded-xl bg-neutral-100 px-4 py-3 text-base text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-700"
            />
            {tab === "signup" && (
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value.slice(0, 40))}
                placeholder={t.auth.displayNamePlaceholder}
                autoComplete="nickname"
                maxLength={40}
                className="mt-2 w-full rounded-xl bg-neutral-100 px-4 py-3 text-base text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-700"
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
            {err && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                {err}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-2 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:opacity-30 dark:bg-neutral-50 dark:text-neutral-900"
              >
                {cta}
              </button>
            </div>
          </>
        )}
      </motion.form>
    </div>
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
          ? "bg-neutral-900 text-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
          : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800")
      }
    >
      {children}
    </button>
  );
}
