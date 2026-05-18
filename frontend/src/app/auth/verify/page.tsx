"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthError, verifyToken } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useUserStore } from "@/stores/userStore";

// Landing du magic link : on lit ?t=... dans l'URL, on POST verify, on
// hydrate le store et on propose un retour vers Jolyne. Cookie set par le
// backend → la racine détecte le user au prochain fetchMe.
type State =
  | { kind: "verifying" }
  | { kind: "ok"; email: string }
  | { kind: "err" };

export default function VerifyPage() {
  const [state, setState] = useState<State>({ kind: "verifying" });
  const setUser = useUserStore((s) => s.setUser);
  const t = useT();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("t");
    if (!token) {
      setState({ kind: "err" });
      return;
    }
    verifyToken(token)
      .then((u) => {
        setUser(u);
        setState({ kind: "ok", email: u.email });
      })
      .catch((e) => {
        if (e instanceof AuthError) {
          setState({ kind: "err" });
        } else {
          setState({ kind: "err" });
        }
      });
  }, [setUser]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      {state.kind === "verifying" && (
        <p className="text-base text-neutral-500 dark:text-neutral-400">
          {t.auth.verifying}
        </p>
      )}
      {state.kind === "ok" && (
        <>
          <p className="text-2xl font-medium text-neutral-900 dark:text-neutral-50">
            {t.auth.verified}
          </p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {state.email}
          </p>
          <Link
            href="/"
            className="mt-2 rounded-xl bg-neutral-900 px-5 py-3 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
          >
            {t.auth.backToChat}
          </Link>
        </>
      )}
      {state.kind === "err" && (
        <>
          <p className="text-2xl font-medium text-neutral-900 dark:text-neutral-50">
            {t.auth.verifyFailed}
          </p>
          <Link
            href="/"
            className="mt-2 text-sm text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            {t.auth.backToChat}
          </Link>
        </>
      )}
    </main>
  );
}
