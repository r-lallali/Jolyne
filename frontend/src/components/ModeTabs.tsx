"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Globe, GraduationCap, type LucideIcon, MessagesSquare } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  selectTotalUnread,
  useNotificationStore,
} from "@/stores/notificationStore";

// ModeTabs : barre de navigation flottante "capsule" en haut de la home.
// Trois entrées (rencontre, messages, cours), chacune une icône. L'entrée
// active déploie son libellé et reçoit une pastille pleine qui glisse d'une
// position à l'autre (layoutId partagé) — un seul élément animé, lisible.
//
// Parti pris : icône toujours visible (repère stable), libellé révélé sur le
// seul actif (compacité). L'icône lève l'ambiguïté des entrées inactives, ce
// que les anciennes barres identiques sans label ne faisaient pas.
export type Mode = "anon" | "friends" | "learn";

interface Props {
  mode: Mode;
  onChange: (m: Mode) => void;
}

export function ModeTabs({ mode, onChange }: Props) {
  const t = useT();
  // Source de vérité live — l'InboxProvider alimente ce store via le WS.
  const unreadCount = useNotificationStore(selectTotalUnread);

  const items: {
    id: Mode;
    icon: LucideIcon;
    label: string;
    badge?: number;
  }[] = [
    { id: "anon", icon: Globe, label: t.nav.meet },
    {
      id: "friends",
      icon: MessagesSquare,
      label: t.nav.messages,
      badge: unreadCount,
    },
    { id: "learn", icon: GraduationCap, label: t.nav.courses },
  ];

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center pt-[calc(env(safe-area-inset-top)+0.7rem)] sm:pt-3.5">
      <nav
        aria-label="Navigation"
        className="pointer-events-auto flex items-center gap-1 rounded-full border border-neutral-200/70 bg-white/70 p-1 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_30px_-14px_rgba(0,0,0,0.25)] backdrop-blur-xl dark:border-neutral-800/70 dark:bg-neutral-950/55"
      >
        {items.map((item) => (
          <Tab
            key={item.id}
            icon={item.icon}
            label={item.label}
            badge={item.badge}
            active={mode === item.id}
            onClick={() => onChange(item.id)}
          />
        ))}
      </nav>
    </div>
  );
}

function Tab({
  icon: Icon,
  label,
  badge,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  badge?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={
        "relative flex h-9 items-center rounded-full px-3 outline-none transition-colors " +
        (active
          ? "text-neutral-50 dark:text-neutral-900"
          : "text-neutral-500 hover:bg-neutral-900/[0.04] hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-50/[0.06] dark:hover:text-neutral-100")
      }
    >
      {/* Pastille pleine partagée : glisse + se redimensionne entre entrées. */}
      {active && (
        <motion.span
          layoutId="nav-active-pill"
          aria-hidden
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="absolute inset-0 rounded-full bg-neutral-900 dark:bg-neutral-50"
        />
      )}
      <span className="relative z-10 flex items-center">
        <span className="relative">
          <Icon className="h-[18px] w-[18px]" strokeWidth={2.1} aria-hidden />
          <AnimatePresence>
            {!!badge && (
              <motion.span
                key="badge"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                aria-label={`${badge} message(s) non lu(s)`}
                className="pointer-events-none absolute -right-2 -top-2 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white dark:ring-neutral-950"
              >
                {badge > 99 ? "99+" : badge}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        {/* Libellé : largeur animée vers `auto` pour le morphing à l'ouverture. */}
        <AnimatePresence initial={false}>
          {active && (
            <motion.span
              key="label"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "auto", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden whitespace-nowrap text-[13px] font-semibold tracking-tight"
            >
              <span className="pl-2">{label}</span>
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </button>
  );
}
