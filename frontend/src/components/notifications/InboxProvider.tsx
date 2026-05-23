"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { fetchCloudName } from "@/lib/account";
import { getFriendProfile, listFriends, type FriendSummary } from "@/lib/friends";
import { openInboxWS } from "@/lib/inbox_ws";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUserStore } from "@/stores/userStore";
import { NotificationToasts } from "@/components/notifications/NotificationToasts";
import { PushOptIn } from "@/components/notifications/PushOptIn";

// InboxProvider : monté une seule fois dans le layout. Tant que l'user
// est authentifié, ouvre le WS /ws/inbox et alimente le store de
// notifications (unread + toasts).
//
// Règles produit :
//   - On ne déclenche pas de toast si la conv correspondante est ouverte
//     (URL = /chats/{id}) — l'user voit déjà le message en live.
//   - On ne déclenche pas de toast si l'ami est en sourdine (flag local
//     localStorage `jolyne:muted_friend_{id}`).
//   - On incrémente toujours l'unread (la bulle s'affiche même si muted),
//     sauf si la conv est ouverte (auto-mark-as-read côté serveur).

const muteKey = (id: number) => `jolyne:muted_friend_${id}`;

export function InboxProvider() {
  const user = useUserStore((s) => s.user);
  const hydrated = useUserStore((s) => s.hydrated);
  const pathname = usePathname();

  const hydrateUnread = useNotificationStore((s) => s.hydrateUnread);
  const incrementUnread = useNotificationStore((s) => s.incrementUnread);
  const clearUnread = useNotificationStore((s) => s.clearUnread);
  const pushToast = useNotificationStore((s) => s.pushToast);

  // On garde une map fraîche des amis (peer_name + photo) pour pouvoir
  // enrichir les toasts entrants. Mise à jour au mount + sur les events
  // `removed` (le serveur a invalidé l'amitié → on re-fetch).
  const friendsRef = useRef<Map<number, FriendSummary>>(new Map());
  const pathnameRef = useRef(pathname);
  const cloudRef = useRef("");
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!hydrated || !user) return;
    let cancelled = false;

    const loadFriends = async () => {
      try {
        const [list, cn] = await Promise.all([
          listFriends(),
          fetchCloudName().catch(() => ""),
        ]);
        if (cancelled) return;
        cloudRef.current = cn;
        const map = new Map<number, FriendSummary>();
        const unread: Record<number, number> = {};
        for (const f of list) {
          map.set(f.id, f);
          if (f.unread_count > 0) unread[f.id] = f.unread_count;
        }
        friendsRef.current = map;
        hydrateUnread(unread);
      } catch {
        // silent — on continue avec ce qu'on a
      }
    };
    loadFriends();

    const handle: { reconnect: () => void; close: () => void } = openInboxWS((ev) => {
      if (ev.type === "msg") {
        // Heuristique "conv ouverte" : on regarde l'URL. Si l'utilisateur
        // est sur /chats/{id} qui matche le friend_id, on ne notifie pas.
        const openMatch = pathnameRef.current?.match(/^\/chats\/(\d+)/);
        const openFriendID = openMatch ? Number(openMatch[1]) : null;
        const isOpen = openFriendID === ev.friend_id;
        if (!isOpen) {
          incrementUnread(ev.friend_id);
          const muted =
            typeof window !== "undefined" &&
            localStorage.getItem(muteKey(ev.friend_id)) === "1";
          if (!muted) {
            // Va chercher le profil frais — la photo principale peut avoir
            // changé depuis le snapshot pris au boot. Fallback sur le
            // cache liste si l'appel échoue (offline, 404, etc.).
            const cached = friendsRef.current.get(ev.friend_id);
            getFriendProfile(ev.friend_id)
              .then((p) => {
                const main =
                  p.photos.find((ph) => ph.position === 1)?.public_id ??
                  p.photos[0]?.public_id;
                if (cached) {
                  friendsRef.current.set(ev.friend_id, {
                    ...cached,
                    peer_name: p.display_name || cached.peer_name,
                    peer_photo_id: main ?? cached.peer_photo_id,
                  });
                }
                pushToast({
                  friendId: ev.friend_id,
                  senderId: ev.sender_id,
                  peerName: p.display_name || cached?.peer_name || "—",
                  peerPhotoId: main ?? cached?.peer_photo_id,
                  preview: ev.preview,
                  sentAt: ev.sent_at,
                });
              })
              .catch(() => {
                pushToast({
                  friendId: ev.friend_id,
                  senderId: ev.sender_id,
                  peerName: cached?.peer_name ?? "—",
                  peerPhotoId: cached?.peer_photo_id,
                  preview: ev.preview,
                  sentAt: ev.sent_at,
                });
              });
          }
        }
      } else if (ev.type === "read") {
        clearUnread(ev.friend_id);
      } else if (ev.type === "removed") {
        clearUnread(ev.friend_id);
        friendsRef.current.delete(ev.friend_id);
      } else if (ev.type === "streak_milestone") {
        const f = friendsRef.current.get(ev.friend_id);
        pushToast({
          friendId: ev.friend_id,
          senderId: 0,
          peerName: f?.peer_name ?? "—",
          peerPhotoId: f?.peer_photo_id,
          preview: "",
          sentAt: new Date().toISOString(),
          milestone: ev.streak,
        });
      } else if (ev.type === "friends_changed") {
        // Un ami a été ajouté/retiré côté serveur : re-fetch la liste pour
        // mettre à jour le cache, et reconnect le WS afin que le backend
        // re-souscrive aux bons channels (ce qui inclut le nouveau friend).
        loadFriends();
        handle.reconnect();
      }
    });

    return () => {
      cancelled = true;
      handle.close();
    };
  }, [hydrated, user, hydrateUnread, incrementUnread, clearUnread, pushToast]);

  if (!hydrated || !user) return null;
  return (
    <>
      <PushOptIn />
      <NotificationToasts cloudName={cloudRef.current} />
    </>
  );
}
