import { create } from "zustand";

// Source du paywall : détermine le message affiché dans la modale.
export type PaywallSource = "swipe" | "translate" | "bot";

// Store global du paywall Premium. N'importe quel composant (popover de
// traduction, écran d'erreur swipe, prof IA) appelle `show(source)` ; une
// unique <PaywallModal /> montée à la racine lit cet état. Évite tout prop
// drilling à travers l'arbre chat.
interface PaywallState {
  open: boolean;
  source: PaywallSource | null;
  show: (source: PaywallSource) => void;
  hide: () => void;
}

export const usePaywallStore = create<PaywallState>((set) => ({
  open: false,
  source: null,
  show: (source) => set({ open: true, source }),
  hide: () => set({ open: false }),
}));
