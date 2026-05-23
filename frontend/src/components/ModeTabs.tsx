"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  selectTotalUnread,
  useNotificationStore,
} from "@/stores/notificationStore";

// ModeTabs : 2 barres horizontales côte à côte en haut de la home, façon
// indicateurs de stories Instagram. Le bar actif est noir / blanc opaque,
// l'inactif gris discret. Cliquer un bar appelle onChange.
//
// Pas de libellés : la disposition (gauche = chat anonyme, droite = amis)
// est apprise une fois et l'affichage en pâtit visuellement si on ajoute du
// texte. Au survol on annonce via title ; lecteurs d'écran via aria-label.
export type Mode = "anon" | "friends";

interface Props {
  mode: Mode;
  onChange: (m: Mode) => void;
}

export function ModeTabs({ mode, onChange }: Props) {
  // Source de vérité live — l'InboxProvider alimente ce store via le WS.
  const unreadCount = useNotificationStore(selectTotalUnread);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center pt-[calc(env(safe-area-inset-top)+0.85rem)] sm:pt-4">
      <div className="pointer-events-auto flex items-center gap-2">
        <Bar
          active={mode === "anon"}
          onClick={() => onChange("anon")}
          label="Chat anonyme"
        />
        <span className="relative">
          <Bar
            active={mode === "friends"}
            onClick={() => onChange("friends")}
            label="Mes conversations"
          />
          <AnimatePresence>
            {unreadCount > 0 && (
              <motion.span
                key="badge"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                aria-label={`${unreadCount} message(s) non lu(s)`}
                className="pointer-events-none absolute -right-2 -top-2 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold leading-none text-white shadow-sm ring-2 ring-white dark:ring-neutral-950"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </div>
    </div>
  );
}

function Bar({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className="group relative flex h-4 w-24 items-center justify-center sm:h-3"
    >
      <motion.span
        aria-hidden
        animate={{
          opacity: active ? 1 : 0.3,
          scaleY: active ? 1 : 0.7,
        }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="block h-[6px] w-full rounded-full bg-neutral-900 transition-colors group-hover:bg-neutral-700 dark:bg-neutral-50 dark:group-hover:bg-neutral-300 sm:h-[5px]"
      />
    </button>
  );
}
