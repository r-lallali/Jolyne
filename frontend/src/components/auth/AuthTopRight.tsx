"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LoginSheet } from "@/components/auth/LoginSheet";
import { useT } from "@/lib/i18n";
import { useUserStore } from "@/stores/userStore";

// Widget compact en haut à droite (à côté du ThemeToggle). Affiche
// "Se connecter" si pas de session, sinon un email tronqué + menu
// déconnexion. Le menu est en survol/clic, pas une popover pleine.
export function AuthTopRight() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const user = useUserStore((s) => s.user);
  const hydrated = useUserStore((s) => s.hydrated);
  const userLogout = useUserStore((s) => s.logout);
  const [loginOpen, setLoginOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Avant hydratation on n'affiche rien pour éviter le flash "Se connecter"
  // → "{email}" lors du bootstrap.
  if (!hydrated) return null;

  if (!user) {
    return (
      <>
        <button
          type="button"
          onClick={() => setLoginOpen(true)}
          className="rounded-full bg-neutral-900/5 px-3 py-1.5 text-xs font-medium text-neutral-700 backdrop-blur-sm transition-colors hover:bg-neutral-900/10 dark:bg-neutral-50/5 dark:text-neutral-300 dark:hover:bg-neutral-50/10"
        >
          {t.auth.loginCta}
        </button>
        <LoginSheet open={loginOpen} onClose={() => setLoginOpen(false)} />
      </>
    );
  }

  const initial = user.email[0]?.toUpperCase() ?? "?";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
        aria-label={user.email}
      >
        {initial}
      </button>
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 top-11 z-50 min-w-[200px] overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
            <Link
              href="/account"
              onClick={() => {
                setMenuOpen(false);
                // Mémorise la page courante pour y revenir après save / back
                // sur /account (chat anonyme `/` ou liste `/chats`).
                if (pathname && pathname !== "/account") {
                  sessionStorage.setItem("jolyne:accountReturnTo", pathname);
                }
              }}
              className="block w-full px-3 py-2 text-left text-xs text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
            >
              {t.auth.accountCta}
            </Link>
            <button
              type="button"
              onClick={async () => {
                setMenuOpen(false);
                await userLogout();
                // Si on était sur une page auth-only (/account, /chats…),
                // on retombe sur la home. Inutile sinon — la home re-render
                // sans la sidebar amis et avec le cluster "Se connecter".
                if (pathname && pathname !== "/") router.push("/");
              }}
              className="block w-full px-3 py-2 text-left text-xs text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
            >
              {t.auth.logoutCta}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
