"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { FlipNumber } from "@/components/ui/FlipNumber";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { fetchQueueSize } from "@/lib/queueSize";
import { useSessionStore } from "@/stores/sessionStore";

const POLL_MS = 4_000;

interface Props {
  // Bascule vers un partenaire humain (= next() côté useMatch). En chat bot
  // de repli (botMode off), next relance le matching humain immédiatement.
  onSwitch: () => void;
}

// BotQueueWatch : encart affiché pendant un chat avec le prof IA de REPLI
// (tombé sur le bot faute d'humain). Compte en direct les pairs compatibles
// désormais en file (mêmes langues, paire inversée) et propose, dès qu'il y
// en a au moins un, de basculer vers une vraie personne. Bouton grisé tant
// que la file est vide.
export function BotQueueWatch({ onSwitch }: Props) {
  const t = useT();
  const speaks = useSessionStore((s) => s.speaks);
  const wants = useSessionStore((s) => s.wants);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!speaks || !wants) return;
    let alive = true;
    const ctrl = new AbortController();
    const tick = async () => {
      try {
        const n = await fetchQueueSize(speaks, wants, ctrl.signal);
        if (alive) setCount(n);
      } catch {
        // Endpoint indispo : on garde la dernière valeur connue, pas de flash.
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      ctrl.abort();
      clearInterval(id);
    };
  }, [speaks, wants]);

  const n = count ?? 0;
  const available = n >= 1;

  return (
    <div className="flex justify-center px-4 pb-1 pt-2">
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="flex flex-col items-center gap-2 rounded-2xl bg-neutral-100/80 px-4 py-3 backdrop-blur-sm dark:bg-neutral-900/70"
      >
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            <FlipNumber value={n} />
          </span>
          <span className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            {t.setup.queueWaitingSuffix({ count: n })}
          </span>
        </div>
        <button
          type="button"
          onClick={available ? onSwitch : undefined}
          disabled={!available}
          aria-disabled={!available}
          className={cn(
            "w-full rounded-xl px-4 py-2 text-xs font-semibold transition-colors",
            available
              ? "bg-neutral-900 text-neutral-50 hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
              : "cursor-not-allowed bg-neutral-200/70 text-neutral-400 dark:bg-neutral-800/70 dark:text-neutral-600",
          )}
        >
          {t.chat.switchToHuman}
        </button>
      </motion.div>
    </div>
  );
}
