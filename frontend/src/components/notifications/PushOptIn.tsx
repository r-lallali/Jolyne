"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { subscribePush, getExistingSubscription } from "@/lib/push";

// PushOptIn : banner discret pour activer les notifications push. Ne
// s'affiche que si :
//   - le browser supporte le Push API + Notifications
//   - Notification.permission === "default" (jamais demandé)
//   - le user n'a pas dismiss la banner pour cette session
// Cliquer sur "Activer" déclenche le prompt natif puis subscribe.

const DISMISS_KEY = "jolyne:push_dismissed_session";

export function PushOptIn() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
    if (!("Notification" in window) || !("PushManager" in window)) return;
    if (Notification.permission !== "default") {
      // Si déjà accordée, on peut re-subscribe silencieusement (le browser
      // peut avoir révoqué l'abonnement même avec permission OK).
      if (Notification.permission === "granted") {
        getExistingSubscription().then((sub) => {
          if (!sub) {
            subscribePush().catch(() => {});
          }
        });
      }
      return;
    }
    // Léger délai pour ne pas spammer dès l'arrivée — donne le temps à
    // l'user de se repérer.
    const id = setTimeout(() => setShow(true), 2500);
    return () => clearTimeout(id);
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        await subscribePush();
      }
    } catch {
      // ignore
    }
    setBusy(false);
    setShow(false);
  };

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-[55] flex justify-center px-3 sm:bottom-6"
        >
          <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-neutral-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-950/95">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                Activer les notifications
              </p>
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                Recevez un signal même app fermée.
              </p>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
            >
              Plus tard
            </button>
            <button
              type="button"
              onClick={enable}
              disabled={busy}
              className="rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-neutral-50 dark:text-neutral-900"
            >
              Activer
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
