"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import {
  translateText,
  TranslateError,
  TranslateQuotaError,
} from "@/lib/translate";
import { usePaywallStore } from "@/stores/paywallStore";
import { useUserStore } from "@/stores/userStore";
import { speak, speechSupported } from "@/lib/speech";
import { saveVocab } from "@/lib/vocab";

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
  | { kind: "loading" }
  | {
      kind: "ok";
      translated: string;
      detected?: string;
      romanization?: string;
      remaining: number;
    }
  | { kind: "err"; message: string }
  | { kind: "limit" };

// Petit tooltip flottant premium ancré à la sélection.
// Traduit AUTOMATIQUEMENT le texte au chargement ou changement de requête.
export function TranslationPopover({ request, onClose }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  // État du bouton "sauvegarder dans le carnet" (visible une fois traduit,
  // pour les users connectés). idle → saving → saved, ou error.
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const t = useT();
  const showPaywall = usePaywallStore((s) => s.show);
  const user = useUserStore((s) => s.user);

  // Fermeture sur clic extérieur ou Escape.
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
    const timer = setTimeout(
      () => window.addEventListener("mousedown", onDown),
      0,
    );
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      clearTimeout(timer);
    };
  }, [onClose]);

  // Lance automatiquement la traduction quand le texte ou les langues changent.
  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    setSaveState("idle");

    const performTranslation = async () => {
      try {
        const { translated, detected, romanization, remaining } =
          await translateText(request.text, request.source, request.target);
        if (active) {
          setState({ kind: "ok", translated, detected, romanization, remaining });
        }
      } catch (e) {
        if (!active) return;
        if (e instanceof TranslateQuotaError) {
          setState({ kind: "limit" });
        } else {
          const msg =
            e instanceof TranslateError
              ? t.translate.unavailable
              : t.translate.genericError;
          setState({ kind: "err", message: msg });
        }
      }
    };

    performTranslation();

    return () => {
      active = false;
    };
  }, [
    request.text,
    request.source,
    request.target,
    t.translate.unavailable,
    t.translate.genericError,
  ]);

  // On clamp à droite pour ne pas déborder.
  const left = Math.min(Math.max(request.x, 80), window.innerWidth - 240);

  // Sauvegarde du couple (terme original → traduction) dans le carnet.
  // Réservé aux users connectés (le carnet est lié au compte). Idempotent
  // côté backend : re-sauver remonte le mot en tête. La langue source
  // stockée est celle détectée par le serveur quand on a envoyé "auto".
  const handleSave = async (translated: string, detected?: string) => {
    if (saveState === "saving" || saveState === "saved") return;
    setSaveState("saving");
    try {
      await saveVocab({
        term: request.text,
        translation: translated,
        source: detected ?? request.source,
        target: request.target,
      });
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

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
      className="min-w-[180px] max-w-[320px] rounded-2xl border border-neutral-200 bg-white/95 p-3.5 text-xs shadow-xl backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-950/95"
    >
      <div className="flex flex-col gap-2">
        {/* En-tête : texte original + langue + prononciation */}
        <div className="border-b border-neutral-100 pb-1.5 dark:border-neutral-800">
          <div className="flex items-start justify-between gap-2">
            <span className="line-clamp-2 font-medium text-neutral-500 dark:text-neutral-400">
              « {request.text} »
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                {/* "auto" n'est pas une langue : on affiche la langue détectée
                    une fois la réponse arrivée, un placeholder en attendant. */}
                {request.source !== "auto"
                  ? request.source
                  : state.kind === "ok" && state.detected
                    ? state.detected
                    : "· · ·"}
              </span>
              {speechSupported() && (
                <button
                  type="button"
                  onClick={() =>
                    speak(
                      request.text,
                      (state.kind === "ok" && state.detected) ||
                        (request.source !== "auto" ? request.source : ""),
                    )
                  }
                  aria-label={t.translate.listen}
                  title={t.translate.listen}
                  className="inline-flex size-5 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 active:scale-90 dark:text-neutral-500 dark:hover:bg-neutral-900 dark:hover:text-neutral-300"
                >
                  <SpeakerIcon />
                </button>
              )}
            </span>
          </div>
          {/* Romanisation du texte source (pinyin, rōmaji…) — chemin IA. */}
          {state.kind === "ok" && state.romanization && (
            <p className="mt-0.5 text-[11px] italic text-neutral-400 dark:text-neutral-500">
              {state.romanization}
            </p>
          )}
        </div>

        {/* Corps : Loader, Résultat ou Erreur */}
        {state.kind === "loading" && (
          <div className="flex items-center gap-2 py-1 text-neutral-500 dark:text-neutral-400">
            {/* Spinner animé élégant */}
            <svg
              className="size-3.5 animate-spin text-emerald-500"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="animate-pulse">{t.translate.loading}</span>
          </div>
        )}

        {state.kind === "ok" && (
          <div className="py-0.5">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              <span>{request.target}</span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="size-2.5"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                />
              </svg>
              <span className="text-[9px] font-normal normal-case text-neutral-400 dark:text-neutral-500">
                {t.translate.label}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-neutral-900 dark:text-neutral-50">
              {state.translated}
            </p>
            {state.remaining >= 0 && (
              <p className="mt-2 text-[10px] text-neutral-400 dark:text-neutral-500">
                {t.translate.remaining({ count: state.remaining })}
              </p>
            )}
            {user && (
              <button
                type="button"
                onClick={() => handleSave(state.translated, state.detected)}
                disabled={saveState === "saving" || saveState === "saved"}
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-[11px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
              >
                {saveState === "saved" ? (
                  <>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      className="size-3 text-emerald-500"
                      aria-hidden
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4.5 12.75l6 6 9-13.5"
                      />
                    </svg>
                    {t.vocab.saved}
                  </>
                ) : saveState === "error" ? (
                  t.vocab.saveError
                ) : (
                  <>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="size-3"
                      aria-hidden
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
                      />
                    </svg>
                    {t.vocab.save}
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {state.kind === "limit" && (
          <div className="flex flex-col gap-2 py-0.5">
            <p className="font-medium text-neutral-700 dark:text-neutral-300">
              {t.translate.limitReached}
            </p>
            <button
              type="button"
              onClick={() => {
                showPaywall("translate");
                onClose();
              }}
              className="w-full rounded-lg bg-neutral-900 px-3 py-1.5 text-[11px] font-semibold text-neutral-50 transition-opacity hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
            >
              {t.translate.limitCta}
            </button>
          </div>
        )}

        {state.kind === "err" && (
          <div className="flex items-center gap-1.5 py-1 text-red-600 dark:text-red-400">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className="size-3.5 shrink-0"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
            <p className="font-medium">{state.message}</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// SpeakerIcon : petit haut-parleur pour prononcer le texte original (TTS
// navigateur, cf. lib/speech).
function SpeakerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3"
      aria-hidden
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

