import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LangCode } from "@/lib/langs";
import type { UILang } from "@/lib/i18n/types";

interface SessionState {
  pseudo: string;
  speaks: LangCode | null;
  wants: LangCode | null;
  ageAccepted: boolean;
  // Langue de l'interface. null = on dérive automatiquement (speaks → navigator
  // → en). Le user peut forcer via le sélecteur dans le SetupView.
  uiLang: UILang | null;
  setPseudo: (v: string) => void;
  setLangs: (speaks: LangCode, wants: LangCode | null) => void;
  acceptAge: (v: boolean) => void;
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
      uiLang: null,
      setPseudo: (pseudo) => set({ pseudo }),
      setLangs: (speaks, wants) => set({ speaks, wants }),
      acceptAge: (ageAccepted) => set({ ageAccepted }),
      setUILang: (uiLang) => set({ uiLang }),
      clear: () =>
        set({
          pseudo: "",
          speaks: null,
          wants: null,
          ageAccepted: false,
          uiLang: null,
        }),
    }),
    { name: "jolyne_session" },
  ),
);
