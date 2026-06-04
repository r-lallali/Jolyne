import { create } from "zustand";

// Store global de "flash" : un message de confirmation transitoire (ex.
// "Enregistré") affiché par un unique <FlashToast /> monté à la racine.
// Découplé de la page qui le déclenche, il survit donc à une navigation —
// /account peut appeler show() puis router.push() vers la page précédente,
// le toast s'affiche sur la page d'arrivée.
interface FlashState {
  message: string | null;
  show: (message: string) => void;
  clear: () => void;
}

export const useFlashStore = create<FlashState>((set) => ({
  message: null,
  show: (message) => set({ message }),
  clear: () => set({ message: null }),
}));
