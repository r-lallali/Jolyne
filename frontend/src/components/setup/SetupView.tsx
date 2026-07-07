"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { AgeGate } from "@/components/AgeGate";
import { AiTeacherToggle } from "@/components/setup/AiTeacherToggle";
import { ScenarioPicker } from "@/components/setup/ScenarioPicker";
import { LangSelector } from "@/components/setup/LangSelector";
import { PseudoInput } from "@/components/setup/PseudoInput";
import { UILangPicker } from "@/components/setup/UILangPicker";
import { FlipNumber } from "@/components/ui/FlipNumber";
import { useMatch } from "@/hooks/useMatch";
import { useSessionStore } from "@/stores/sessionStore";
import { useUserStore } from "@/stores/userStore";
import { fetchAccount } from "@/lib/account";
import { useT } from "@/lib/i18n";
import {
  ALL_LANGS,
  allowedWantsFor,
  isPairAllowed,
  type LangCode,
} from "@/lib/langs";
import { containsProfanity } from "@/lib/profanity";
import { fetchQueueSize } from "@/lib/queueSize";
import { fetchQuota, type QuotaState } from "@/lib/quota";
import { usePaywallStore } from "@/stores/paywallStore";

type Step = "pseudo" | "config";

export function SetupView() {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<Step>("pseudo");

  useEffect(() => {
    setMounted(true);
  }, []);

  const store = useSessionStore();
  const { start } = useMatch();

  const pseudo = mounted ? store.pseudo : "";
  const speaks = mounted ? store.speaks : null;
  const wants = mounted ? store.wants : null;
  const ageAccepted = mounted ? store.ageAccepted : false;
  const botMode = mounted ? store.botMode : false;
  const scenario = mounted ? store.scenario : null;
  const setPseudoRaw = store.setPseudo;
  const setLangs = store.setLangs;
  const acceptAge = store.acceptAge;
  const setBotMode = store.setBotMode;
  const setScenario = store.setScenario;

  // Si l'user est connecté + a un display_name dans son profil, on propose
  // celui-ci comme suggestion italique (en place du placeholder). État
  // strictement local, JAMAIS écrit dans le sessionStore — sinon un reload
  // ramènerait la valeur en texte plein sans italique. Promotion vers une
  // vraie pseudo uniquement au moment du Start, si l'user n'a rien tapé.
  const user = useUserStore((s) => s.user);
  const userHydrated = useUserStore((s) => s.hydrated);
  const [suggestion, setSuggestion] = useState("");
  const prefillTried = useRef(false);
  useEffect(() => {
    if (!mounted || !userHydrated || !user) return;
    if (prefillTried.current) return;
    prefillTried.current = true;
    fetchAccount()
      .then((acc) => {
        const name = acc.profile.display_name.trim();
        if (!name) return;
        setSuggestion(name.slice(0, 20));
      })
      .catch(() => {});
  }, [mounted, userHydrated, user]);

  const setPseudo = (v: string) => setPseudoRaw(v);

  // effectivePseudo = ce qu'on utilisera au start (pseudo tapé ou, à défaut,
  // la suggestion). Les validations (taille, profanity, canStart) s'appuient
  // dessus pour autoriser le démarrage même si l'user n'a rien retouché.
  const effectivePseudo = pseudo.length > 0 ? pseudo : suggestion;
  const pseudoBlocked =
    effectivePseudo.length >= 3 && containsProfanity(effectivePseudo);
  const canNext = effectivePseudo.length >= 3 && !pseudoBlocked;
  const canStart = canNext && isPairAllowed(speaks, wants) && ageAccepted;

  // Polling toutes les 5s du nombre de peers en attente sur la paire
  // sélectionnée. null = pas encore connu ; -1 = endpoint indisponible.
  const [queueCount, setQueueCount] = useState<number | null>(null);
  useEffect(() => {
    // En mode prof IA on ne match pas d'humain : le compteur d'attente n'a
    // aucun sens, on coupe le polling.
    if (
      step !== "config" ||
      botMode ||
      !speaks ||
      !wants ||
      !isPairAllowed(speaks, wants)
    ) {
      setQueueCount(null);
      return;
    }
    let alive = true;
    const ctrl = new AbortController();
    const tick = async () => {
      try {
        const n = await fetchQueueSize(speaks, wants, ctrl.signal);
        if (alive) setQueueCount(n);
      } catch {
        if (alive) setQueueCount(-1);
      }
    };
    tick();
    const id = setInterval(tick, 5_000);
    return () => {
      alive = false;
      ctrl.abort();
      clearInterval(id);
    };
  }, [step, speaks, wants, botMode]);

  // Quota prof IA : on charge l'état des compteurs en arrivant sur l'étape
  // config, pour afficher les messages restants sous l'option et la griser si
  // la limite est atteinte. Fail-soft : si l'appel échoue, on n'affiche
  // simplement pas de compteur (option laissée active). Premium = illimité.
  const showPaywall = usePaywallStore((s) => s.show);
  const [quota, setQuota] = useState<QuotaState | null>(null);
  useEffect(() => {
    if (step !== "config") return;
    let alive = true;
    const ctrl = new AbortController();
    fetchQuota(ctrl.signal)
      .then((q) => alive && setQuota(q))
      .catch(() => alive && setQuota(null));
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [step]);

  const isPremium = quota?.plan === "premium";
  // Restant à afficher : null pour Premium (illimité) ou tant que non chargé.
  const botRemaining = quota && !isPremium ? quota.bot.remaining : null;
  const botExhausted = botRemaining !== null && botRemaining <= 0;

  // Si la limite est atteinte alors que le mode prof IA était coché (ex. quota
  // épuisé dans l'onglet pendant la session), on le décoche pour ne pas lancer
  // une recherche vouée au paywall.
  useEffect(() => {
    if (botExhausted && botMode) setBotMode(false);
  }, [botExhausted, botMode, setBotMode]);

  // Langues à griser dans le picker "wants" : tant que speaks n'est pas
  // choisi on grise tout ; sinon on grise speaks + toutes les langues qui
  // ne forment pas une paire ouverte avec speaks (voir PLAN.md §8).
  const wantsExclude: readonly LangCode[] = speaks
    ? ALL_LANGS.filter((c) => !isPairAllowed(speaks, c))
    : ALL_LANGS;

  // Hash routing pour les étapes : URL = `/#config` ou `/`. setStep piloté
  // par hashchange — un seul chemin pour bouton in-app + back/swipe Safari.
  //
  // animateConfigEnter / animatePseudoEnter : on slide la carte cible QUE
  // quand le user déclenche une action in-app (clic Suivant ou Retour).
  // Sur back/swipe natif on snap pour ne pas superposer deux animations.
  const animateConfigEnter = useRef(false);
  const animatePseudoEnter = useRef(false);

  const goConfig = () => {
    if (!canNext) return;
    animateConfigEnter.current = true;
    window.location.hash = "config";
  };

  const goBack = () => {
    animatePseudoEnter.current = true;
    if (typeof window !== "undefined" && window.location.hash) {
      window.history.back();
    } else {
      setStep("pseudo");
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      const target = window.location.hash === "#config" ? "config" : "pseudo";
      // Reset croisé : arriver sur une étape désarme l'anim d'entrée de
      // l'autre, pour que la prochaine arrivée respecte le déclencheur
      // (button=animer, swipe=snap).
      if (target === "pseudo") animateConfigEnter.current = false;
      if (target === "config") animatePseudoEnter.current = false;
      setStep(target);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

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
    <div className="flex w-full max-w-md flex-col items-center justify-start px-4 pb-8 pt-[calc(env(safe-area-inset-top)+3.5rem)] sm:p-0">
      {/* Titre toujours visible. mt-auto/mb-auto (header/footer) centrent le
          bloc quand il tient dans le viewport mais retombent à 0 quand le
          contenu déborde (étape config sur mobile) : le titre reste alors en
          haut et atteignable au scroll, au lieu d'être rogné par un
          justify-center. */}
      <header className="mb-10 mt-auto text-center">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-900 dark:text-white">
          Jolyne
        </h1>
      </header>

      {/* Conteneur des steps : pas d'AnimatePresence entre pseudo/config —
          la transition est instantanée pour ne pas se battre avec l'anim
          native du swipe-back Safari. */}
      <div className="w-full">
        {step === "pseudo" && (
          <motion.div
            initial={
              animatePseudoEnter.current ? { x: -60, opacity: 0 } : false
            }
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
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
                  suggestion={suggestion}
                  autoFocus={!user}
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
            initial={
              animateConfigEnter.current ? { x: 60, opacity: 0 } : false
            }
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
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

                  <SwapButton
                    canSwap={!!speaks && !!wants && isPairAllowed(wants, speaks)}
                    onSwap={() => {
                      if (speaks && wants) setLangs(wants, speaks);
                    }}
                  />

                  <div className="flex flex-col gap-3">
                    <CardLabel>{t.setup.iWantPractice}</CardLabel>
                    <LangSelector
                      value={wants}
                      onChange={handleWantsChange}
                      exclude={wantsExclude}
                    />
                  </div>

                  <AiTeacherToggle
                    value={botMode}
                    onChange={setBotMode}
                    disabled={botExhausted}
                    onDisabledClick={() => showPaywall("bot")}
                    remaining={botRemaining}
                  />

                  {botMode && (
                    <ScenarioPicker
                      value={scenario}
                      onChange={setScenario}
                      isPremium={isPremium}
                      onLockedClick={() => showPaywall("scenario")}
                    />
                  )}

                  {queueCount !== null && queueCount >= 0 && (
                    <div className="flex flex-col items-center gap-1 pt-1">
                      <div className="rounded-xl bg-white px-4 py-2 font-mono text-3xl font-semibold tracking-tight text-neutral-900 shadow-inner ring-1 ring-neutral-200 dark:bg-neutral-950 dark:text-neutral-50 dark:ring-neutral-800">
                        <FlipNumber value={queueCount} />
                      </div>
                      <p className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                        {t.setup.queueWaitingSuffix({ count: queueCount })}
                      </p>
                    </div>
                  )}
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
                    onClick={() => {
                      // Promotion finale : si l'user n'a rien tapé, on commit
                      // la suggestion comme vrai pseudo avant le start (sinon
                      // useMatch lit sessionStore.pseudo = "" et bail).
                      if (pseudo.length === 0 && suggestion.length >= 3) {
                        setPseudoRaw(suggestion);
                      }
                      start();
                    }}
                    disabled={!canStart}
                    className="flex-1 rounded-xl bg-neutral-900 px-4 py-3.5 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-20 dark:bg-white dark:text-neutral-950"
                  >
                    {t.setup.start}
                  </button>
                </div>
              </Card>
          </motion.div>
        )}
      </div>

      <footer className="mb-auto mt-10 flex items-center gap-4 text-center">
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

// SwapButton remplace l'ancienne flèche décorative ↓. Quand les deux
// langues sont choisies, un clic les échange (et anime un demi-tour pour
// donner un feedback visuel). Grisé sinon — pas d'opération possible.
function SwapButton({
  canSwap,
  onSwap,
}: {
  canSwap: boolean;
  onSwap: () => void;
}) {
  return (
    <div className="flex items-center justify-center">
      <motion.button
        type="button"
        onClick={canSwap ? onSwap : undefined}
        disabled={!canSwap}
        whileTap={canSwap ? { rotate: 180 } : undefined}
        transition={{ duration: 0.3, ease: "easeOut" }}
        aria-label="Échanger les langues"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-neutral-100 disabled:hover:text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 dark:disabled:hover:bg-neutral-900 dark:disabled:hover:text-neutral-400"
      >
        <svg
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M7 4v16" />
          <path d="m3 8 4-4 4 4" />
          <path d="M17 20V4" />
          <path d="m13 16 4 4 4-4" />
        </svg>
      </motion.button>
    </div>
  );
}
