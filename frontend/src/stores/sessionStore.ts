import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LangCode } from "@/lib/langs";
import type { UILang } from "@/lib/i18n/types";

interface SessionState {
  pseudo: string;
  speaks: LangCode | null;
  wants: LangCode | null;
  ageAccepted: boolean;
  // Mode prof IA : le user veut tomber directement sur un prof IA plutôt que
  // sur un partenaire humain. Éphémère — volontairement NON persisté (cf.
  // partialize plus bas) pour ne pas coincer le user en mode bot au prochain
  // chargement sans qu'il s'en souvienne. Repart toujours à false.
  botMode: boolean;
  // Scénario de jeu de rôle du prof IA (id du catalogue lib/scenarios.ts).
  // null = chat libre. Éphémère comme botMode (non persisté), remis à null
  // quand botMode est décoché.
  scenario: string | null;
  // Langue de l'interface. null = on dérive automatiquement (speaks → navigator
  // → en). Le user peut forcer via le sélecteur dans le SetupView.
  uiLang: UILang | null;
  setPseudo: (v: string) => void;
  setLangs: (speaks: LangCode, wants: LangCode | null) => void;
  acceptAge: (v: boolean) => void;
  setBotMode: (v: boolean) => void;
  setScenario: (v: string | null) => void;
  setUILang: (v: UILang | null) => void;
  clear: () => void;
}

// Stocke uniquement ce qui doit survivre à un rechargement : pseudo,
// préférence de langues et choix manuel de langue UI. L'identifiant device
// (fingerprint) vit dans son propre fichier ; tout le reste (status WS,
// messages) est éphémère.
// Voir CLAUDE.md §"State" : "persistance localStorage : pseudo + UUID
// anonyme. Rien d'autre."
export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      pseudo: "",
      speaks: null,
      wants: null,
      ageAccepted: false,
      botMode: false,
      scenario: null,
      uiLang: null,
      setPseudo: (pseudo) => set({ pseudo }),
      setLangs: (speaks, wants) => set({ speaks, wants }),
      acceptAge: (ageAccepted) => set({ ageAccepted }),
      // Décocher le mode prof IA abandonne aussi le scénario choisi.
      setBotMode: (botMode) =>
        set(botMode ? { botMode } : { botMode, scenario: null }),
      setScenario: (scenario) => set({ scenario }),
      setUILang: (uiLang) => set({ uiLang }),
      clear: () =>
        set({
          pseudo: "",
          speaks: null,
          wants: null,
          ageAccepted: false,
          botMode: false,
          scenario: null,
          uiLang: null,
        }),
    }),
    {
      name: "jolyne_session",
      // botMode est volontairement absent : préférence éphémère qui ne doit
      // pas survivre à un reload (sinon le user resterait en mode prof IA
      // sans s'en rendre compte). Tout le reste persiste comme avant.
      partialize: (s) => ({
        pseudo: s.pseudo,
        speaks: s.speaks,
        wants: s.wants,
        ageAccepted: s.ageAccepted,
        uiLang: s.uiLang,
      }),
    },
  ),
);
