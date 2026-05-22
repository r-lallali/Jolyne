"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cloudinaryUrl } from "@/lib/account";
import { useNotificationStore } from "@/stores/notificationStore";

// NotificationToasts : stack de notifications style "ajout au panier" en
// haut à droite. Chaque toast s'efface automatiquement après 5s, on peut
// cliquer pour ouvrir la conv, croix pour fermer. Empilement vertical
// avec spring entry/exit.

const TOAST_TTL_MS = 5000;

export function NotificationToasts({ cloudName }: { cloudName: string }) {
  const router = useRouter();
  const toasts = useNotificationStore((s) => s.toasts);
  const dismissToast = useNotificationStore((s) => s.dismissToast);

  // Auto-dismiss : un timer par toast — quand il monte, on programme sa
  // suppression. Le cleanup couvre le cas "fermé à la main avant timeout".
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      setTimeout(() => dismissToast(t.id), TOAST_TTL_MS),
    );
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [toasts, dismissToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[70] flex w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-2 sm:right-6 sm:top-6">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            type="button"
            onClick={() => {
              dismissToast(t.id);
              router.push(`/chats/${t.friendId}`);
            }}
            initial={{ opacity: 0, x: 40, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="pointer-events-auto flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white/95 px-3 py-2.5 text-left shadow-lg backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-950/95"
          >
            <div className="size-9 shrink-0 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              {t.peerPhotoId && cloudName ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cloudinaryUrl(cloudName, t.peerPhotoId, { w: 72, h: 72 })}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xs font-semibold text-neutral-500">
                  {t.peerName.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                {t.peerName}
              </p>
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                {t.preview || "…"}
              </p>
            </div>
            <span
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(t.id);
              }}
              className="shrink-0 text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
              role="button"
              aria-label="Fermer"
            >
              ✕
            </span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
