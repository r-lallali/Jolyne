"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Ban,
  CreditCard,
  Filter,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  Repeat,
  ScrollText,
  Server,
  ShieldAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { fetchMe, logout } from "@/lib/admin";
import { cn } from "@/lib/cn";

// Navigation du back-office : sidebar sur desktop, barre horizontale sur
// mobile. Surligne l'entrée active et affiche l'admin connecté en pied.

type NavLink = { href: string; label: string; icon: LucideIcon };

const groups: { title: string; links: NavLink[] }[] = [
  {
    title: "Analytics",
    links: [
      { href: "/admin", label: "Vue d'ensemble", icon: LayoutDashboard },
      { href: "/admin/funnel", label: "Funnel", icon: Filter },
      { href: "/admin/retention", label: "Rétention", icon: Repeat },
      { href: "/admin/engagement", label: "Engagement", icon: MessagesSquare },
      { href: "/admin/revenue", label: "Revenus", icon: CreditCard },
      { href: "/admin/server", label: "Serveur", icon: Server },
    ],
  },
  {
    title: "Gestion",
    links: [
      { href: "/admin/users", label: "Utilisateurs", icon: Users },
      { href: "/admin/reports", label: "Signalements", icon: ShieldAlert },
      { href: "/admin/bans", label: "Bans", icon: Ban },
      { href: "/admin/audit", label: "Audit", icon: ScrollText },
    ],
  },
];

const allLinks = groups.flatMap((g) => g.links);

export default function AdminChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);

  const onLogin = pathname === "/admin/login";

  useEffect(() => {
    if (onLogin) return;
    fetchMe()
      .then((m) => setEmail(m?.email ?? null))
      .catch(() => setEmail(null));
  }, [onLogin]);

  if (onLogin) return <>{children}</>;

  const onLogout = async () => {
    await logout();
    window.location.href = "/admin/login";
  };

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <div className="flex min-h-dvh bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-neutral-200/80 bg-white px-3 py-5 dark:border-neutral-800 dark:bg-neutral-900 sm:flex">
        <div className="flex items-center gap-2 px-2 pb-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-900 text-xs font-bold text-white dark:bg-white dark:text-neutral-900">
            J
          </span>
          <span className="text-[15px] font-semibold tracking-tight">
            Jolyne
            <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
              admin
            </span>
          </span>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
                {g.title}
              </div>
              <ul className="space-y-0.5">
                {g.links.map((l) => {
                  const active = isActive(l.href);
                  const Icon = l.icon;
                  return (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className={cn(
                          "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                          active
                            ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-white"
                            : "text-neutral-500 hover:bg-neutral-100/70 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/50 dark:hover:text-neutral-200",
                        )}
                      >
                        {active && (
                          <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-emerald-500" />
                        )}
                        <Icon
                          size={17}
                          strokeWidth={2}
                          className={cn(
                            active
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-neutral-400 group-hover:text-neutral-500",
                          )}
                        />
                        {l.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="mt-4 border-t border-neutral-200/80 pt-3 dark:border-neutral-800">
          {email && (
            <div className="flex items-center gap-2 px-2 pb-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {email[0]?.toUpperCase()}
              </span>
              <span className="truncate text-xs text-neutral-500" title={email}>
                {email}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <LogOut size={17} strokeWidth={2} className="text-neutral-400" />
            Se déconnecter
          </button>
        </div>
      </aside>

      {/* Contenu + barre mobile */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex items-center gap-1 overflow-x-auto border-b border-neutral-200 bg-white/90 px-3 py-2 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90 sm:hidden">
          {allLinks.map((l) => {
            const active = isActive(l.href);
            const Icon = l.icon;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                  active
                    ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                    : "text-neutral-500 dark:text-neutral-400",
                )}
              >
                <Icon size={14} strokeWidth={2} />
                {l.label}
              </Link>
            );
          })}
        </div>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
