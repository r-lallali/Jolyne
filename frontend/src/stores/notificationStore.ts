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
}

interface NotificationState {
  unreadByFriend: Record<number, number>;
  toasts: ToastNotification[];

  // Bulk reset depuis le fetch HTTP de la liste — appelé par FriendsMode /
  // la page /chats à chaque refresh.
  hydrateUnread: (entries: Record<number, number>) => void;

  // Live updates émis par le WS inbox.
  incrementUnread: (friendId: number) => void;
  clearUnread: (friendId: number) => void;

  // Toast queue.
  pushToast: (t: Omit<ToastNotification, "id">) => void;
  dismissToast: (id: string) => void;
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  unreadByFriend: {},
  toasts: [],
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
