"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { fetchQuota } from "@/lib/quota";
import { useChatStore } from "@/stores/chatStore";

// BotQuotaCounter : petit compteur « messages prof IA restants » affiché
// pendant un chat avec le bot (repli OU mode prof IA voulu), pour les comptes
// Free. Se rafraîchit à chaque nouveau message (le bot décompte un crédit par
// réponse). Masqué pour Premium (illimité) et en cas d'erreur de fetch.
export function BotQuotaCounter() {
  const t = useT();
  const messageCount = useChatStore((s) => s.messages.length);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    fetchQuota(ctrl.signal)
      .then((q) => {
        if (!alive) return;
        // Premium → illimité (remaining -1) → on masque le compteur.
        setRemaining(q.plan === "premium" ? null : q.bot.remaining);
      })
      .catch(() => {
        /* fail-soft : pas de compteur si l'appel échoue */
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [messageCount]);

  if (remaining === null) return null;

  return (
    <div className="flex justify-center px-4 pt-2">
      <span className="rounded-full bg-neutral-100/80 px-3 py-1 text-[11px] font-medium text-neutral-500 backdrop-blur-sm dark:bg-neutral-900/70 dark:text-neutral-400">
        {t.setup.aiTeacherRemaining({ count: remaining })}
      </span>
    </div>
  );
}
