"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AgeGate } from "@/components/AgeGate";
import { LangSelector } from "@/components/setup/LangSelector";
import { PseudoInput } from "@/components/setup/PseudoInput";
import { UILangPicker } from "@/components/setup/UILangPicker";
import { useMatch } from "@/hooks/useMatch";
import { useSessionStore } from "@/stores/sessionStore";
import { useT } from "@/lib/i18n";
import { allowedWantsFor, isPairAllowed, type LangCode } from "@/lib/langs";
import { containsProfanity } from "@/lib/profanity";

const ALL_LANGS: LangCode[] = ["fr", "en", "es", "de"];

type Step = "pseudo" | "config";

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 80 : -80, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -80 : 80, opacity: 0 }),
};

export function SetupView() {
  const t = useT();
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

  const pseudoBlocked = pseudo.length >= 3 && containsProfanity(pseudo);
  const canNext = pseudo.length >= 3 && !pseudoBlocked;
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
    <div className="flex w-full max-w-md flex-col items-center justify-center px-4 py-8 sm:p-0">
      {/* Titre toujours visible */}
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-900 dark:text-white">
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
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  goConfig();
                }}
              >
                <Card>
                  <CardLabel>{t.setup.chooseNick}</CardLabel>
                  <PseudoInput
                    value={pseudo}
                    onChange={setPseudo}
                    placeholder={t.setup.nickPlaceholder}
                  />
                  {pseudoBlocked && (
                    <p className="mt-3 text-center text-xs text-red-600 dark:text-red-400">
                      {t.setup.pseudoBlocked}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={!canNext}
                    className="mt-6 w-full rounded-xl bg-neutral-900 px-4 py-3.5 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-20 dark:bg-white dark:text-neutral-950"
                  >
                    {t.setup.next}
                  </button>
                </Card>
              </form>
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
                    <CardLabel>{t.setup.iSpeak}</CardLabel>
                    <LangSelector
                      value={speaks}
                      onChange={handleSpeaksChange}
                      exclude={wants}
                    />
                  </div>

                  {/* Flèche séparatrice */}
                  <div className="flex items-center justify-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500">
                      ↓
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <CardLabel>{t.setup.iWantPractice}</CardLabel>
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
                    className="rounded-xl bg-neutral-100 px-4 py-3.5 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                  >
                    {t.setup.back}
                  </button>
                  <button
                    type="button"
                    onClick={start}
                    disabled={!canStart}
                    className="flex-1 rounded-xl bg-neutral-900 px-4 py-3.5 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-20 dark:bg-white dark:text-neutral-950"
                  >
                    {t.setup.start}
                  </button>
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <footer className="mt-10 flex items-center gap-4 text-center">
        <a
          href="/legal"
          className="text-xs text-neutral-500 underline-offset-4 transition-colors hover:text-neutral-900 hover:underline dark:text-neutral-500 dark:hover:text-neutral-100"
        >
          {t.setup.legal}
        </a>
        <span aria-hidden className="text-xs text-neutral-400 dark:text-neutral-700">
          ·
        </span>
        <UILangPicker />
      </footer>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-neutral-100/60 p-6 backdrop-blur-sm dark:bg-neutral-900/50">
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-500">
      {children}
    </span>
  );
}
