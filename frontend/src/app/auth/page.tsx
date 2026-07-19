"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmailForm, Forgot } from "@/components/auth/AuthViews";
import { BackIcon, GoogleIcon } from "@/components/auth/icons";
import TrackPageView from "@/components/TrackPageView";
import { BackButton } from "@/components/ui/BackButton";
import { useAuthForm } from "@/hooks/useAuthForm";
import { getOAuthProviders, type OAuthProvider } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useUserStore } from "@/stores/userStore";

// Page d'authentification dédiée (/auth). Sobre : tout est visible d'un
// seul regard — Google en tête, formulaire e-mail dessous, connexion par
// défaut (bascule inscription par lien). La LoginSheet reste pour les flows
// contextuels (paywall, ajout d'ami) ; ici c'est la destination canonique
// du bouton « Se connecter ».
export default function AuthPage() {
  const t = useT();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const hydrated = useUserStore((s) => s.hydrated);
  const form = useAuthForm("login", () => router.push("/"));
  const [view, setView] = useState<"form" | "forgot">("form");
  const [providers, setProviders] = useState<OAuthProvider[]>([]);

  // Déjà connecté (ou retour OAuth réussi) → rien à faire ici.
  useEffect(() => {
    if (hydrated && user) router.replace("/");
  }, [hydrated, user, router]);

  useEffect(() => {
    let alive = true;
    void getOAuthProviders().then((list) => {
      if (alive) setProviders(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const login = form.mode === "login";

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-12">
      <TrackPageView />
      <div className="fixed left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 sm:left-4 sm:top-4">
        <BackButton href="/" label={t.auth.backToApp} />
      </div>
      <div className="w-full max-w-sm">
        <p className="text-center text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          Jolyne
        </p>

        {view === "forgot" ? (
          <div className="mt-8">
            <button
              type="button"
              onClick={() => setView("form")}
              className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              <BackIcon />
              {t.common.back}
            </button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void form.submitForgot();
              }}
            >
              <Forgot
                t={t}
                sent={form.sent}
                busy={form.busy}
                err={form.err}
                email={form.fields.email}
                setEmail={form.set.setEmail}
                onDone={() => {
                  form.setSent(false);
                  setView("form");
                }}
              />
            </form>
          </div>
        ) : (
          <>
            <div className="mt-6 text-center">
              <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
                {login ? t.auth.loginTitle : t.auth.signupTitle}
              </h1>
              <p className="mx-auto mt-1.5 max-w-[19rem] text-sm text-neutral-500 dark:text-neutral-400">
                {login ? t.auth.loginHint : t.auth.signupHint}
              </p>
            </div>

            {providers.includes("google") && (
              <>
                <button
                  type="button"
                  disabled={form.busy}
                  onClick={() => form.startOAuthFlow("google")}
                  className="mt-6 flex h-12 w-full items-center justify-center gap-2.5 rounded-2xl border border-neutral-200 bg-white text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-30 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  <GoogleIcon />
                  {t.auth.continueWithGoogle}
                </button>
                <div className="mt-5 flex items-center gap-3 text-xs text-neutral-400 dark:text-neutral-500">
                  <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                  {t.auth.orSeparator}
                  <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                </div>
              </>
            )}

            <form
              className="mt-5"
              onSubmit={(e) => {
                e.preventDefault();
                void form.submitCredentials();
              }}
            >
              <EmailForm
                t={t}
                mode={form.mode}
                busy={form.busy}
                err={form.err}
                fields={form.fields}
                set={form.set}
                onSwitchMode={form.switchMode}
                onForgot={() => setView("forgot")}
                showHeader={false}
              />
            </form>
          </>
        )}
      </div>
    </main>
  );
}
