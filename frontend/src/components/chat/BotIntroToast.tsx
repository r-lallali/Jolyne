"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

// BotIntroToast : petit popup non-intrusif quand le user voit un bot
// pour la première fois dans sa session navigateur. Dismiss définitif via
// localStorage — on ne le rejoue qu'à la prochaine session.

const STORAGE_KEY = "jolyne:bot_intro_seen";
const AUTO_DISMISS_MS = 12_000;

export function BotIntroToast({ show }: { show: boolean }) {
  const t = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!show) return;
    if (typeof window === "undefined") return;
    if (localStorage.getItem(STORAGE_KEY) === "1") return;
    setVisible(true);
    const id = setTimeout(() => {
      setVisible(false);
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // ignore (incognito / quota)
      }
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [show]);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4.5rem)] z-40 flex justify-center px-4 sm:top-20"
        >
          <div className="pointer-events-auto max-w-md rounded-2xl border border-indigo-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md dark:border-indigo-500/30 dark:bg-neutral-950/95">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
              {t.chat.botIntroTitle}
            </p>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              {t.chat.botIntroHint}
            </p>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={dismiss}
                className="rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-neutral-50 transition-opacity hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
              >
                {t.chat.botIntroDismiss}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
