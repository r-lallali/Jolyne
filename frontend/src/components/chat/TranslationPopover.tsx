"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { translateText, TranslateError } from "@/lib/translate";

export interface TranslationRequest {
  text: string;
  // Position viewport-relative du bas de la sélection (rect.bottom/center).
  x: number;
  y: number;
  source: string;
  target: string;
}

interface Props {
  request: TranslationRequest;
  onClose: () => void;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; translated: string }
  | { kind: "err"; message: string };

// Petit tooltip flottant ancré à la sélection. Cycle :
//   1) "Traduire" (clic explicite — pas d'appel involontaire).
//   2) Loader.
//   3) Résultat + bouton fermer.
export function TranslationPopover({ request, onClose }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });

  // Fermeture sur clic ou Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-translation-popover]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    // setTimeout pour ne pas attraper le mouseup qui a ouvert le popover.
    const t = setTimeout(
      () => window.addEventListener("mousedown", onDown),
      0,
    );
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      clearTimeout(t);
    };
  }, [onClose]);

  const onTranslate = async () => {
    setState({ kind: "loading" });
    try {
      const translated = await translateText(
        request.text,
        request.source,
        request.target,
      );
      setState({ kind: "ok", translated });
    } catch (e) {
      const msg =
        e instanceof TranslateError ? "Service indisponible" : "Erreur";
      setState({ kind: "err", message: msg });
    }
  };

  // On clamp à droite pour ne pas déborder. La hauteur est faible donc
  // pas de gestion verticale fine pour l'instant.
  const left = Math.min(Math.max(request.x, 80), window.innerWidth - 240);

  return (
    <motion.div
      data-translation-popover
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      style={{
        position: "fixed",
        top: request.y + 6,
        left,
        transform: "translateX(-50%)",
        zIndex: 50,
      }}
      className="min-w-[160px] max-w-[300px] rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
    >
      {state.kind === "idle" && (
        <button
          type="button"
          onClick={onTranslate}
          className="flex w-full items-center justify-between gap-3 text-left text-neutral-700 dark:text-neutral-300"
        >
          <span className="truncate font-medium">{request.text}</span>
          <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
            Traduire
          </span>
        </button>
      )}
      {state.kind === "loading" && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Traduction…
        </p>
      )}
      {state.kind === "ok" && (
        <div>
          <p className="text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            {request.source} → {request.target}
          </p>
          <p className="mt-1 text-neutral-900 dark:text-neutral-50">
            {state.translated}
          </p>
        </div>
      )}
      {state.kind === "err" && (
        <p className="text-xs text-red-600 dark:text-red-400">{state.message}</p>
      )}
    </motion.div>
  );
}
