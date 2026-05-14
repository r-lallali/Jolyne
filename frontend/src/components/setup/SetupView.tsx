"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AgeGate } from "@/components/AgeGate";
import { LangSelector } from "@/components/setup/LangSelector";
import { PseudoInput } from "@/components/setup/PseudoInput";
import { useMatch } from "@/hooks/useMatch";
import { useSessionStore } from "@/stores/sessionStore";
import { allowedWantsFor, isPairAllowed, type LangCode } from "@/lib/langs";

const ALL_LANGS: LangCode[] = ["fr", "en", "es", "de"];

type Step = "pseudo" | "config";

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 80 : -80, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -80 : 80, opacity: 0 }),
};

export function SetupView() {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<Step>("pseudo");
  const [dir, setDir] = useState(1);

  useEffect(() => {
    setMounted(true);
  }, []);

  const store = useSessionStore();
  const { start } = useMatch();

  const pseudo = mounted ? store.pseudo : "";
  const speaks = mounted ? store.speaks : null;
  const wants = mounted ? store.wants : null;
  const ageAccepted = mounted ? store.ageAccepted : false;
  const setPseudo = store.setPseudo;
  const setLangs = store.setLangs;
  const acceptAge = store.acceptAge;

  const canNext = pseudo.length >= 3;
  const canStart = canNext && isPairAllowed(speaks, wants) && ageAccepted;

  // Langues à griser dans le picker "wants" : tant que speaks n'est pas
  // choisi on grise tout ; sinon on grise speaks + toutes les langues qui
  // ne forment pas une paire ouverte avec speaks (voir PLAN.md §8).
  const wantsExclude: LangCode[] = speaks
    ? ALL_LANGS.filter((c) => !isPairAllowed(speaks, c))
    : ALL_LANGS;

  const goConfig = () => {
    if (!canNext) return;
    setDir(1);
    setStep("config");
  };

  const goBack = () => {
    setDir(-1);
    setStep("pseudo");
  };

  const handleSpeaksChange = (code: LangCode) => {
    // Reset wants si la nouvelle paire (code → wants) n'est plus ouverte.
    const allowed = allowedWantsFor(code);
    const newWants = wants && allowed.includes(wants) ? wants : null;
    setLangs(code, newWants);
  };

  const handleWantsChange = (code: LangCode) => {
    if (!speaks) return;
    setLangs(speaks, code);
  };

  return (
    <div className="flex w-full max-w-md flex-col items-center">
      {/* Titre toujours visible */}
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white">
          Jolyne
        </h1>
      </header>

      {/* Conteneur des steps */}
      <div className="relative w-full" style={{ minHeight: 320 }}>
        <AnimatePresence mode="wait" custom={dir}>
          {step === "pseudo" && (
            <motion.div
              key="pseudo"
              custom={dir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="w-full"
            >
              <Card>
                <CardLabel>Choisis ton pseudo</CardLabel>
                <PseudoInput value={pseudo} onChange={setPseudo} />
                <button
                  type="button"
                  onClick={goConfig}
                  disabled={!canNext}
                  className="mt-6 w-full rounded-xl bg-white px-4 py-3.5 text-sm font-semibold text-neutral-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-20"
                >
                  Suivant
                </button>
              </Card>
            </motion.div>
          )}

          {step === "config" && (
            <motion.div
              key="config"
              custom={dir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="w-full"
            >
              <Card>
                {/* Sélection des langues */}
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-3">
                    <CardLabel>Je parle</CardLabel>
                    <LangSelector
                      value={speaks}
                      onChange={handleSpeaksChange}
                      exclude={wants}
                    />
                  </div>

                  {/* Flèche séparatrice */}
                  <div className="flex items-center justify-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-800 text-neutral-500">
                      ↓
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <CardLabel>Je veux pratiquer</CardLabel>
                    <LangSelector
                      value={wants}
                      onChange={handleWantsChange}
                      exclude={wantsExclude}
                    />
                  </div>
                </div>

                {/* Age gate */}
                <div className="mt-8">
                  <AgeGate value={ageAccepted} onChange={acceptAge} />
                </div>

                {/* Actions */}
                <div className="mt-6 flex gap-3">
                  <button
                    type="button"
                    onClick={goBack}
                    className="rounded-xl border border-neutral-800 px-4 py-3.5 text-sm font-medium text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-300"
                  >
                    Retour
                  </button>
                  <button
                    type="button"
                    onClick={start}
                    disabled={!canStart}
                    className="flex-1 rounded-xl bg-white px-4 py-3.5 text-sm font-semibold text-neutral-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-20"
                  >
                    Commencer
                  </button>
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-800/60 bg-neutral-900/50 p-6 backdrop-blur-sm">
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-500">
      {children}
    </span>
  );
}
