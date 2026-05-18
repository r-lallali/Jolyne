import { create } from "zustand";
import { fetchMe, logout as apiLogout, type AuthUser } from "@/lib/auth";

// Store éphémère (pas de persistance localStorage) : la source de vérité
// reste le cookie HttpOnly côté serveur. On hydrate au boot via fetchMe.
// `hydrated` distingue "pas encore vérifié" de "vérifié + non connecté".

interface UserState {
  user: AuthUser | null;
  hydrated: boolean;
  bootstrap: () => Promise<void>;
  setUser: (u: AuthUser) => void;
  logout: () => Promise<void>;
}

export const useUserStore = create<UserState>((set) => ({
  user: null,
  hydrated: false,

  bootstrap: async () => {
    try {
      const u = await fetchMe();
      set({ user: u, hydrated: true });
    } catch {
      // Endpoint down / réseau : on considère non connecté plutôt que
      // bloquer l'UI. L'auth est optionnelle.
      set({ user: null, hydrated: true });
    }
  },

  setUser: (user) => set({ user, hydrated: true }),

  logout: async () => {
    await apiLogout();
    set({ user: null });
  },
}));
