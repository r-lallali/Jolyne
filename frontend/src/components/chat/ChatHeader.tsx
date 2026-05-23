"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { cloudinaryUrl } from "@/lib/account";
import { buzz } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";

interface Props {
  peerNick: string | null;
  // Avatar Cloudinary du peer s'il est authentifié — public_id + cloud_name.
  // Tous deux vides = pas d'avatar, on garde juste le point vert + nick.
  peerPhotoId?: string;
  cloudName?: string;
  onNext: () => void;
  onStop: () => void;
  onReport: () => void;
  canReport: boolean;
  canNext: boolean;
  // En post_chat la PostChatCard prend le relai pour les actions (Suivant /
  // Quitter), on cache donc les boutons du header pour ne pas dupliquer
  // l'offre et éviter le visuel "tout grisé".
  postChat: boolean;
  // Timestamp du début du cooldown anti-zap (null hors période).
  cooldownStart: number | null;
  cooldownMs: number;
  peerVerified?: boolean;
  // Affiche un badge "🤖 Prof IA" à côté du nom — cf. backend bot_manager.
  peerIsBot?: boolean;
}

export function ChatHeader({
  peerNick,
  peerPhotoId,
  cloudName,
  onNext,
  onStop,
  onReport,
  canReport,
  canNext,
  postChat,
  cooldownStart,
  cooldownMs,
  peerVerified,
  peerIsBot,
}: Props) {
  const t = useT();
  const hasAvatar = !!(peerPhotoId && cloudName);
  const initial = peerNick ? peerNick.slice(0, 1).toUpperCase() : "";
  return (
    <header className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
      <div className="flex min-w-0 items-center gap-2.5">
        {hasAvatar ? (
          <span className="inline-block size-7 shrink-0 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <img
              src={cloudinaryUrl(cloudName!, peerPhotoId!, { w: 96, h: 96 })}
              alt=""
              className="h-full w-full object-cover"
            />
          </span>
        ) : initial ? (
          // Pas de photo Cloudinary : on dérive un avatar texte avec la
          // première lettre du pseudo. Cohérent avec ce qu'on fait dans
          // FriendsMode pour les amis sans photo.
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {initial}
          </span>
        ) : (
          <motion.span
            aria-hidden
            animate={{ opacity: [1, 0.5, 1], scale: [1, 1.15, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="inline-block size-2 rounded-full bg-emerald-500"
          />
        )}
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {peerNick ?? "—"}
          </p>
          {peerVerified && (
            <span className="shrink-0 text-emerald-500 dark:text-emerald-400" title="Profil Vérifié">
              <VerifiedBadge />
            </span>
          )}
          {peerIsBot && (
            <span
              className="shrink-0 rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
              title={t.chat.botBadgeTitle}
            >
              🤖 {t.chat.botBadge}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 pr-12 sm:pr-0">
        <button
          type="button"
          onClick={onReport}
          disabled={!canReport}
          aria-label={t.chat.reportLabel}
          title={t.chat.reportTitle}
          className="inline-flex size-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-500 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-red-400"
        >
          <FlagIcon />
        </button>
        {!postChat && (
          <>
            <NextButton
              canNext={canNext}
              cooldownStart={cooldownStart}
              cooldownMs={cooldownMs}
              onConfirm={onNext}
              nextLabel={t.chat.next}
              confirmLabel={t.chat.confirmQuit}
            />
            <QuitButton
              onConfirm={onStop}
              quitLabel={t.chat.quit}
              confirmLabel={t.chat.confirmQuit}
            />
          </>
        )}
      </div>
    </header>
  );
}

function FlagIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 22V4" />
      <path d="M4 4h12l-2 4 2 4H4" />
    </svg>
  );
}

// NextButton : pill compact "→ Suivant" avec ring d'outline pill qui se
// vide en 3s autour du bouton. Click 1 → "Confirmer ?" en emerald (3s) ;
// click 2 dans la fenêtre = onConfirm.
//
// Le ring est un SVG rounded-rect dont le `pathLength` est normalisé à 1
// pour qu'on puisse animer `strokeDashoffset: 0 → 1` indépendamment de
// la taille réelle du contour.
function NextButton({
  canNext,
  cooldownStart,
  cooldownMs,
  onConfirm,
  nextLabel,
  confirmLabel,
}: {
  canNext: boolean;
  cooldownStart: number | null;
  cooldownMs: number;
  onConfirm: () => void;
  nextLabel: string;
  confirmLabel: string;
}) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (cooldownStart !== null) {
      setArmed(false);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [cooldownStart]);

  const click = () => {
    if (!canNext) return;
    if (armed) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      setArmed(false);
      buzz(15);
      onConfirm();
      return;
    }
    setArmed(true);
    timerRef.current = setTimeout(() => {
      setArmed(false);
      timerRef.current = null;
    }, 3000);
  };

  const showCooldown = cooldownStart !== null && !canNext;

  return (
    <button
      type="button"
      onClick={click}
      disabled={!canNext}
      className={cn(
        "group relative inline-flex h-9 items-center gap-1.5 overflow-hidden rounded-full px-3.5 text-xs font-medium leading-none transition-colors",
        armed
          ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:bg-emerald-500/15 dark:text-emerald-400"
          : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900",
        !canNext &&
          "cursor-not-allowed text-neutral-400 hover:bg-transparent dark:text-neutral-600",
      )}
    >
      {showCooldown &&
        (() => {
          // Reprend la fill au pourcentage déjà écoulé. Permet un remount
          // (switch d'onglet "conversations" → retour) sans rejouer toute
          // l'anim depuis 0 %.
          const elapsed = Math.max(0, Date.now() - cooldownStart!);
          const startPct = Math.min(100, (elapsed / cooldownMs) * 100);
          const remaining = Math.max(0, cooldownMs - elapsed);
          return (
            <motion.span
              key={cooldownStart}
              aria-hidden
              initial={{ width: `${startPct}%` }}
              animate={{ width: "100%" }}
              transition={{ duration: remaining / 1000, ease: "linear" }}
              className="pointer-events-none absolute inset-y-0 left-0 bg-neutral-200 dark:bg-neutral-700"
            />
          );
        })()}
      <span className="relative tracking-tight">
        {armed ? confirmLabel : nextLabel}
      </span>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(
          "relative size-3.5 transition-transform",
          !armed && canNext && "group-hover:translate-x-0.5",
        )}
      >
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </svg>
    </button>
  );
}

// QuitButton : click-to-confirm. Premier clic → "Confirmer ?" en rouge
// pendant 3s. Second clic dans la fenêtre → onConfirm. Sinon, revient à
// "Quitter" silencieusement. Évite les mauvaises manips sur mobile.
function QuitButton({
  onConfirm,
  quitLabel,
  confirmLabel,
}: {
  onConfirm: () => void;
  quitLabel: string;
  confirmLabel: string;
}) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const click = () => {
    if (armed) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      setArmed(false);
      onConfirm();
      return;
    }
    setArmed(true);
    timerRef.current = setTimeout(() => {
      setArmed(false);
      timerRef.current = null;
    }, 3000);
  };

  return (
    <button
      type="button"
      onClick={click}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
        armed
          ? "bg-red-500/10 text-red-600 hover:bg-red-500/15 dark:bg-red-500/15 dark:text-red-400"
          : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
      )}
    >
      {armed ? confirmLabel : quitLabel}
    </button>
  );
}
