"use client";

import { useState } from "react";
import type { EmailMode } from "@/components/auth/AuthViews";
import {
  AuthError,
  forgotPassword,
  login as apiLogin,
  signup as apiSignup,
  startOAuth,
  type OAuthProvider,
} from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { passwordValid } from "@/lib/password";
import { track } from "@/lib/track";
import { useUserStore } from "@/stores/userStore";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;

// État + soumission du formulaire d'auth par e-mail (login / signup /
// forgot) et lancement du flow OAuth. Partagé entre la LoginSheet (flows
// contextuels : paywall, ajout d'ami) et la page /auth. Les champs et
// setters épousent la forme des props d'EmailForm (AuthViews).
export function useAuthForm(initialMode: EmailMode, onSuccess: () => void) {
  const t = useT();
  const setUser = useUserStore((s) => s.setUser);
  const [mode, setMode] = useState<EmailMode>(initialMode);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const reset = () => {
    setMode(initialMode);
    setEmail("");
    setDisplayName("");
    setPassword("");
    setPasswordConfirm("");
    setShowPwd(false);
    setBusy(false);
    setErr(null);
    setSent(false);
  };

  const switchMode = (next: EmailMode) => {
    if (next === "signup" && mode !== "signup") void track("signup_started");
    setMode(next);
    setErr(null);
    setPassword("");
    setPasswordConfirm("");
    setShowPwd(false);
  };

  // Login ou signup selon le mode courant. Validation minimale côté client —
  // le serveur re-valide tout (règle d'or #3).
  const submitCredentials = async () => {
    setErr(null);
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setErr(t.auth.invalidEmail);
      return;
    }
    // Login : longueur seule (les comptes historiques n'ont pas forcément
    // suivi les critères). Signup : la checklist complète doit être verte.
    if (mode === "login" && password.length < PASSWORD_MIN) {
      setErr(t.auth.passwordTooShort);
      return;
    }
    if (mode === "signup" && !passwordValid(password)) {
      setErr(t.auth.passwordCriteria);
      return;
    }
    if (mode === "signup" && password !== passwordConfirm) {
      setErr(t.auth.passwordMismatch);
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        setUser(await apiLogin(trimmed, password));
      } else {
        setUser(await apiSignup(trimmed, password, displayName.trim()));
      }
      onSuccess();
    } catch (e) {
      if (e instanceof AuthError && mode === "login" && e.status === 401) {
        setErr(t.auth.invalidCredentials);
      } else if (e instanceof AuthError && e.status === 409) {
        setErr(t.auth.emailAlreadyUsed);
      } else {
        setErr(t.auth.oauthError);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitForgot = async () => {
    setErr(null);
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setErr(t.auth.invalidEmail);
      return;
    }
    setBusy(true);
    try {
      await forgotPassword(trimmed);
      setSent(true);
    } catch {
      setErr(t.auth.oauthError);
    } finally {
      setBusy(false);
    }
  };

  // La navigation quitte la page — busy neutralise juste le double-clic.
  const startOAuthFlow = (provider: OAuthProvider) => {
    setBusy(true);
    void startOAuth(provider);
  };

  return {
    mode,
    busy,
    err,
    sent,
    setSent,
    fields: { email, displayName, password, passwordConfirm, showPwd },
    set: { setEmail, setDisplayName, setPassword, setPasswordConfirm, setShowPwd },
    reset,
    switchMode,
    submitCredentials,
    submitForgot,
    startOAuthFlow,
  };
}
