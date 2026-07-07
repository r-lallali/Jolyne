"use client";

import { useEffect, useState } from "react";
import { Repeat2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { LANG_FLAG, LANG_LABEL, type LangCode } from "@/lib/langs";
import { useChatStore } from "@/stores/chatStore";

// TandemStrip : bande sous le header du chat qui porte tous les états de la
// session tandem 50/50 :
//   - null       → petit bouton « Proposer une session tandem »
//   - proposed   → « proposition envoyée… » (attente du peer)
//   - prompted   → carte accepter / ignorer
//   - active     → bandeau langue de la phase + compte à rebours
// Uniquement pour les matchs humains (le prof IA ne parle que la langue cible).
export function TandemStrip({
  onPropose,
  onAccept,
}: {
  onPropose: () => void;
  onAccept: () => void;
}) {
  const t = useT();
  const tandem = useChatStore((s) => s.tandem);
  const [dismissed, setDismissed] = useState(false);

  // Nouvelle proposition du peer → réafficher même si une précédente a été
  // ignorée dans cette conversation.
  useEffect(() => {
    if (tandem?.kind === "prompted") setDismissed(false);
  }, [tandem?.kind]);

  if (tandem === null) {
    return (
      <div className="flex justify-center border-b border-neutral-200 px-4 py-1.5 dark:border-neutral-800">
        <button
          type="button"
          onClick={onPropose}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
        >
          <Repeat2 className="size-3.5" aria-hidden />
          {t.tandem.propose}
        </button>
      </div>
    );
  }

  if (tandem.kind === "proposed") {
    return (
      <div className="border-b border-neutral-200 px-4 py-2 text-center text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        {t.tandem.waiting}
      </div>
    );
  }

  if (tandem.kind === "prompted") {
    if (dismissed) return null;
    return (
      <div className="flex items-center justify-between gap-3 border-b border-violet-200 bg-violet-50/70 px-4 py-2.5 dark:border-violet-500/30 dark:bg-violet-500/10">
        <p className="min-w-0 text-xs font-medium text-violet-800 dark:text-violet-300">
          🔄 {t.tandem.promptText}
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-full px-3 py-1 text-xs text-violet-500 transition-colors hover:bg-violet-100 dark:hover:bg-violet-500/15"
          >
            {t.tandem.decline}
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="rounded-full bg-violet-600 px-3.5 py-1 text-xs font-bold text-white transition-opacity hover:opacity-90"
          >
            {t.tandem.accept}
          </button>
        </div>
      </div>
    );
  }

  // Session active : langue imposée + compte à rebours de la phase.
  const lang = tandem.lang as LangCode;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-violet-200 bg-violet-50/70 px-4 py-2 dark:border-violet-500/30 dark:bg-violet-500/10">
      <p className="min-w-0 truncate text-xs font-semibold text-violet-800 dark:text-violet-300">
        {LANG_FLAG[lang] ?? "🌐"}{" "}
        {t.tandem.activePhase({ lang: LANG_LABEL[lang] ?? tandem.lang })}
      </p>
      <Countdown startedAt={tandem.startedAt} phaseSec={tandem.phaseSec} />
    </div>
  );
}

// Compte à rebours mm:ss de la phase courante. Purement décoratif : le
// serveur détient la vérité et publiera le switch/end.
function Countdown({ startedAt, phaseSec }: { startedAt: number; phaseSec: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(
    0,
    phaseSec - Math.floor((Date.now() - startedAt) / 1_000),
  );
  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums text-violet-600 dark:text-violet-400">
      {mm}:{ss.toString().padStart(2, "0")}
    </span>
  );
}
