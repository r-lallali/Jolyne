import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LangCode } from "@/lib/langs";

interface SessionState {
  pseudo: string;
  speaks: LangCode | null;
  wants: LangCode | null;
  ageAccepted: boolean;
  setPseudo: (v: string) => void;
  setLangs: (speaks: LangCode, wants: LangCode) => void;
  acceptAge: (v: boolean) => void;
  clear: () => void;
}

// Stocke uniquement ce qui doit survivre à un rechargement : pseudo et
// préférence de langues. L'identifiant device (fingerprint) vit dans son
// propre fichier ; tout le reste (status WS, messages) est éphémère.
// Voir CLAUDE.md §"State" : "persistance localStorage : pseudo + UUID
// anonyme. Rien d'autre."
export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      pseudo: "",
      speaks: null,
      wants: null,
      ageAccepted: false,
      setPseudo: (pseudo) => set({ pseudo }),
      setLangs: (speaks, wants) => set({ speaks, wants }),
      acceptAge: (ageAccepted) => set({ ageAccepted }),
      clear: () =>
        set({ pseudo: "", speaks: null, wants: null, ageAccepted: false }),
    }),
    { name: "jolyne_session" },
  ),
);
