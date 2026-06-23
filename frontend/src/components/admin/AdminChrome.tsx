"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/admin";

// Navigation latérale du back-office. Affichée sur toutes les pages /admin
// sauf /admin/login. Surligne l'entrée active via le pathname.

const groups: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Analytics",
    links: [
      { href: "/admin", label: "Vue d'ensemble" },
      { href: "/admin/funnel", label: "Funnel" },
      { href: "/admin/retention", label: "Rétention" },
      { href: "/admin/engagement", label: "Engagement" },
      { href: "/admin/revenue", label: "Revenus" },
      { href: "/admin/server", label: "Serveur" },
    ],
  },
  {
    title: "Gestion",
    links: [
      { href: "/admin/users", label: "Utilisateurs" },
      { href: "/admin/reports", label: "Signalements" },
      { href: "/admin/bans", label: "Bans" },
      { href: "/admin/audit", label: "Audit" },
    ],
  },
];

export default function AdminChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Page de login : pas de chrome.
  if (pathname === "/admin/login") return <>{children}</>;

  const onLogout = async () => {
    await logout();
    window.location.href = "/admin/login";
  };

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <div className="flex min-h-dvh bg-neutral-50 dark:bg-neutral-950">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-neutral-200 bg-white px-3 py-5 dark:border-neutral-800 dark:bg-neutral-900 sm:flex">
        <div className="px-2 pb-4 text-lg font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          Jolyne <span className="text-neutral-400">admin</span>
        </div>
        <nav className="flex-1 space-y-5">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                {g.title}
              </div>
              <ul className="space-y-0.5">
                {g.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className={`block rounded-lg px-2 py-1.5 text-sm transition-colors ${
                        isActive(l.href)
                          ? "bg-neutral-900 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                          : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      }`}
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <button
          type="button"
          onClick={onLogout}
          className="mt-4 rounded-lg px-2 py-1.5 text-left text-sm text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          Se déconnecter
        </button>
      </aside>

      {/* Barre mobile (nav horizontale scrollable). */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex gap-1 overflow-x-auto border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900 sm:hidden">
          {groups.flatMap((g) => g.links).map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-xs transition-colors ${
                isActive(l.href)
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-600 dark:text-neutral-300"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
