"use client";

import { motion } from "framer-motion";

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
  unreadCount?: number;
}

export function ModeTabs({ mode, onChange, unreadCount = 0 }: Props) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center pt-3 sm:pt-4">
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
          {unreadCount > 0 && (
            <span
              aria-label={`${unreadCount} message(s) non lu(s)`}
              className="pointer-events-none absolute -right-1 -top-1 inline-flex h-2 w-2 rounded-full bg-emerald-500"
            />
          )}
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
      className="group relative flex h-3 w-24 items-center justify-center"
    >
      <motion.span
        aria-hidden
        animate={{
          opacity: active ? 1 : 0.3,
          scaleY: active ? 1 : 0.7,
        }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="block h-[3px] w-full rounded-full bg-neutral-900 transition-colors group-hover:bg-neutral-700 dark:bg-neutral-50 dark:group-hover:bg-neutral-300"
      />
    </button>
  );
}
