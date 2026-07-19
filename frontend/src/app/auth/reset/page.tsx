"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PasswordCriteria } from "@/components/auth/AuthFields";
import { AuthError, resetPassword } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { passwordValid } from "@/lib/password";
import { useUserStore } from "@/stores/userStore";

// Landing du lien email de reset password : lit ?t=..., demande un
// nouveau mot de passe, POST /reset. La session est ouverte au passage.
type State =
  | { kind: "form" }
  | { kind: "ok" }
  | { kind: "err" };

export default function ResetPage() {
  const t = useT();
  const setUser = useUserStore((s) => s.setUser);
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "form" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tok = params.get("t");
    if (!tok) {
      setState({ kind: "err" });
      return;
    }
    setToken(tok);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!token) return;
    if (!passwordValid(password)) {
      setErr(t.auth.passwordCriteria);
      return;
    }
    setBusy(true);
    try {
      const u = await resetPassword(token, password);
      setUser(u);
      setState({ kind: "ok" });
    } catch (e) {
      if (e instanceof AuthError) {
        setState({ kind: "err" });
      } else {
        setErr("Erreur");
      }
    } finally {
      setBusy(false);
    }
  };

  if (state.kind === "ok") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-2xl font-medium text-neutral-900 dark:text-neutral-50">
          {t.auth.resetDone}
        </p>
        <Link
          href="/"
          className="mt-2 rounded-xl bg-neutral-900 px-5 py-3 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
        >
          {t.auth.backToApp}
        </Link>
      </main>
    );
  }
  if (state.kind === "err") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-2xl font-medium text-neutral-900 dark:text-neutral-50">
          {t.auth.resetFailed}
        </p>
        <Link
          href="/"
          className="mt-2 text-sm text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          {t.auth.backToApp}
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-950"
      >
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          {t.auth.resetTitle}
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {t.auth.resetHint}
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t.auth.passwordPlaceholder}
          autoComplete="new-password"
          autoFocus
          className="mt-4 w-full rounded-xl bg-neutral-100 px-4 py-3 text-base text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-700"
        />
        <div className="mt-2">
          <PasswordCriteria t={t} password={password} />
        </div>
        {err && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{err}</p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:opacity-30 dark:bg-neutral-50 dark:text-neutral-900"
        >
          {t.auth.submitReset}
        </button>
      </form>
    </main>
  );
}
