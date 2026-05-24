"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { cloudinaryUrl } from "@/lib/account";
import { useNotificationStore } from "@/stores/notificationStore";

// StreakStartedPopup : célébration "premier streak" (N=2). Apparition
// centrée en haut, gros 🔥, auto-dismiss en 3s. Mounted global dans
// l'InboxProvider, ne dépend pas de la conv ouverte. Distinct du toast
// classique pour signaler le moment spécial.

const AUTO_DISMISS_MS = 3000;

export function StreakStartedPopup({ cloudName }: { cloudName: string }) {
  const event = useNotificationStore((s) => s.streakStarted);
  const clear = useNotificationStore((s) => s.clearStreakStarted);

  useEffect(() => {
    if (!event) return;
    const id = setTimeout(clear, AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [event, clear]);

  return (
    <AnimatePresence>
      {event && (
        <motion.div
          key={`${event.friendId}-${event.at}`}
          initial={{ opacity: 0, y: -24, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 320, damping: 26 }}
          className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+5rem)] z-[80] flex justify-center px-4 sm:top-24"
        >
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 px-4 py-3 shadow-xl dark:border-orange-500/30 dark:from-orange-950/80 dark:to-amber-950/80">
            <div className="size-11 shrink-0 overflow-hidden rounded-full bg-neutral-200 ring-2 ring-orange-400 dark:bg-neutral-800">
              {event.peerPhotoId && cloudName ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cloudinaryUrl(cloudName, event.peerPhotoId, { w: 88, h: 88 })}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-base font-semibold text-neutral-600 dark:text-neutral-300">
                  {event.peerName.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-bold text-orange-700 dark:text-orange-300">
                <motion.span
                  initial={{ scale: 0.6, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 14 }}
                  aria-hidden
                  className="text-xl"
                >
                  🔥
                </motion.span>
                Streak lancé !
              </p>
              <p className="mt-0.5 truncate text-xs text-neutral-600 dark:text-neutral-300">
                2 jours d&apos;affilée avec {event.peerName}
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
