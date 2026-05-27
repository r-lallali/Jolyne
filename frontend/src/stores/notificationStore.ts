import { create } from "zustand";

// Notifications & unread agrégés en temps réel à partir du WS inbox.
// Sert deux UI :
//   - la bulle (badge) sur l'onglet "Mes conversations" — somme des unread
//   - le toast e-commerce-style qui apparaît à droite à chaque nouveau msg
//
// Pas de persistance : tout est ré-hydraté au prochain connect du WS via
// le fetch initial de listFriends() (qui remplit `unreadByFriend`).

export interface ToastNotification {
  id: string;
  friendId: number;
  senderId: number;
  peerName: string;
  peerPhotoId?: string;
  preview: string;
  sentAt: string;
  // Si renseigné, le toast a un style "milestone" — fond chaleureux,
  // grand chiffre + flamme. Le preview est ignoré dans ce mode.
  milestone?: number;
  // Streak courant de l'ami au moment du toast (>= 2). Affiché en
  // sur-impression sous le preview pour donner du contexte social.
  streak?: number;
}

// StreakStartedEvent : célébration du tout premier streak (N=2). Popup
// centré 3s, distinct du toast classique. Une entrée par ami.
export interface StreakStartedEvent {
  friendId: number;
  peerName: string;
  peerPhotoId?: string;
  at: number;
}

// LiveStreak : valeur courante poussée par le WS inbox à chaque message
// (ou par le flow de restauration). Surcharge la valeur HTTP polled de
// la liste d'amis et du profile pour un rendu instantané bilatéral.
export interface LiveStreak {
  streak: number;
  at_risk: boolean;
}

interface NotificationState {
  unreadByFriend: Record<number, number>;
  toasts: ToastNotification[];
  streakStarted: StreakStartedEvent | null;
  streakByFriend: Record<number, LiveStreak>;
  // ID de l'ami dont la conversation est actuellement ouverte (vue
  // inline depuis FriendsMode OU page /chats/[id]). Sert à
  // l'InboxProvider pour ne pas notifier de cet ami pendant qu'on
  // discute avec lui. null = aucune conv ouverte.
  activeFriendId: number | null;

  // Bulk reset depuis le fetch HTTP de la liste — appelé par FriendsMode /
  // la page /chats à chaque refresh.
  hydrateUnread: (entries: Record<number, number>) => void;

  // Live updates émis par le WS inbox.
  incrementUnread: (friendId: number) => void;
  clearUnread: (friendId: number) => void;

  // Toast queue.
  pushToast: (t: Omit<ToastNotification, "id">) => void;
  dismissToast: (id: string) => void;

  // Popup célébration premier streak (N=2). Set sur event inbox, clear
  // automatiquement après 3s par le composant qui l'affiche.
  pushStreakStarted: (e: StreakStartedEvent) => void;
  clearStreakStarted: () => void;
  setActiveFriendId: (id: number | null) => void;

  // Live update du streak (poussé par WS inbox sur chaque message).
  setLiveStreak: (friendId: number, streak: number, atRisk: boolean) => void;
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  unreadByFriend: {},
  toasts: [],
  streakStarted: null,
  streakByFriend: {},
  activeFriendId: null,
  hydrateUnread: (entries) => set({ unreadByFriend: { ...entries } }),
  incrementUnread: (friendId) =>
    set((s) => ({
      unreadByFriend: {
        ...s.unreadByFriend,
        [friendId]: (s.unreadByFriend[friendId] ?? 0) + 1,
      },
    })),
  clearUnread: (friendId) =>
    set((s) => {
      if (!(friendId in s.unreadByFriend)) return s;
      const next = { ...s.unreadByFriend };
      delete next[friendId];
      return { unreadByFriend: next };
    }),
  pushToast: (t) =>
    set((s) => ({
      toasts: [
        ...s.toasts,
        { ...t, id: `${t.friendId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` },
      ],
    })),
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  pushStreakStarted: (e) => set({ streakStarted: e }),
  clearStreakStarted: () => set({ streakStarted: null }),
  setActiveFriendId: (id) => set({ activeFriendId: id }),
  setLiveStreak: (friendId, streak, atRisk) =>
    set((s) => ({
      streakByFriend: {
        ...s.streakByFriend,
        [friendId]: { streak, at_risk: atRisk },
      },
    })),
}));

// Sélecteur dérivé pour la bulle d'onglet — total unread sur toutes les
// conversations. Mémo via un sélecteur égalité-shallow côté composant.
export function selectTotalUnread(s: NotificationState): number {
  let total = 0;
  for (const id in s.unreadByFriend) {
    total += s.unreadByFriend[id] ?? 0;
  }
  return total;
}
