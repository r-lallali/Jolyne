"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BookMarked, LogOut, type LucideIcon, User } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);

  // Le back-office a sa propre navigation (sidebar + déconnexion admin) : on
  // n'affiche pas le menu user de l'app par-dessus (ni le lien Dictionnaire).
  if (pathname?.startsWith("/admin")) return null;

  // Avant hydratation on n'affiche rien pour éviter le flash "Se connecter"
  // → "{email}" lors du bootstrap.
  if (!hydrated) return null;

  if (!user) {
    // Sur /auth le bouton pointerait vers la page courante — inutile.
    if (pathname === "/auth") return null;
    return (
      <Link
        href="/auth"
        className="rounded-full bg-neutral-900/5 px-3 py-1.5 text-xs font-medium text-neutral-700 backdrop-blur-sm transition-colors hover:bg-neutral-900/10 dark:bg-neutral-50/5 dark:text-neutral-300 dark:hover:bg-neutral-50/10"
      >
        {t.auth.loginCta}
      </Link>
    );
  }

  const initial = user.email[0]?.toUpperCase() ?? "?";

  // Entrées du menu. `href` => rendu Link (navigation), sinon bouton (action).
  const items: MenuItemDef[] = [
    {
      icon: User,
      label: t.auth.accountCta,
      href: "/account",
      onSelect: () => {
        setMenuOpen(false);
        // Mémorise la page courante pour y revenir après save / back sur
        // /account (chat anonyme `/` ou liste `/chats`).
        if (pathname && pathname !== "/account") {
          sessionStorage.setItem("jolyne:accountReturnTo", pathname);
        }
      },
    },
    {
      icon: BookMarked,
      label: t.vocab.link,
      href: "/vocab",
      onSelect: () => setMenuOpen(false),
    },
    {
      icon: LogOut,
      label: t.auth.logoutCta,
      onSelect: async () => {
        setMenuOpen(false);
        await userLogout();
        // Si on était sur une page auth-only (/account, /chats…), on retombe
        // sur la home. Inutile sinon — la home re-render sans la sidebar amis
        // et avec le cluster "Se connecter".
        if (pathname && pathname !== "/") router.push("/");
      },
    },
  ];

  return (
    <div className="relative">
      <motion.button
        type="button"
        whileTap={{ scale: 0.94 }}
        onClick={() => setMenuOpen((v) => !v)}
        className={
          "flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-neutral-50 transition-[opacity,box-shadow] hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900 " +
          (menuOpen ? "ring-2 ring-neutral-900/15 dark:ring-neutral-50/20" : "")
        }
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={user.email}
      >
        {initial}
      </motion.button>
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            key="overlay"
            className="fixed inset-0 z-40"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
        )}
        {menuOpen && <MenuPanel key="menu" items={items} />}
      </AnimatePresence>
    </div>
  );
}

interface MenuItemDef {
  icon: LucideIcon;
  label: string;
  href?: string;
  onSelect: () => void;
}

// Panneau déroulant : ouverture en ressort depuis le coin haut-droit, et
// pastille de survol unique qui glisse d'une entrée à l'autre (layoutId
// partagé) — même langage que la pastille active de la barre de navigation.
function MenuPanel({ items }: { items: MenuItemDef[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: -6 }}
      transition={{ type: "spring", stiffness: 460, damping: 32 }}
      style={{ transformOrigin: "top right" }}
      onMouseLeave={() => setHovered(null)}
      role="menu"
      className="absolute right-0 top-11 z-50 min-w-[210px] rounded-2xl border border-neutral-200/80 bg-white/90 p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_40px_-16px_rgba(0,0,0,0.3)] backdrop-blur-xl dark:border-neutral-800/80 dark:bg-neutral-950/80"
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        const cls =
          "relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-neutral-700 outline-none dark:text-neutral-300";
        const inner = (
          <>
            <AnimatePresence>
              {hovered === i && (
                <motion.span
                  layoutId="menu-hover-pill"
                  aria-hidden
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 460, damping: 36 }}
                  className="absolute inset-0 rounded-xl bg-neutral-100 dark:bg-neutral-900"
                />
              )}
            </AnimatePresence>
            <Icon
              className="relative z-10 h-4 w-4 text-neutral-400 dark:text-neutral-500"
              strokeWidth={2}
              aria-hidden
            />
            <span className="relative z-10">{item.label}</span>
          </>
        );
        return item.href ? (
          <Link
            key={item.label}
            href={item.href}
            role="menuitem"
            onClick={item.onSelect}
            onMouseEnter={() => setHovered(i)}
            onFocus={() => setHovered(i)}
            className={cls}
          >
            {inner}
          </Link>
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            onClick={item.onSelect}
            onMouseEnter={() => setHovered(i)}
            onFocus={() => setHovered(i)}
            className={cls}
          >
            {inner}
          </button>
        );
      })}
    </motion.div>
  );
}
