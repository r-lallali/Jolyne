"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fetchCloudName } from "@/lib/account";
import { getFriendProfile, listFriends, type FriendSummary } from "@/lib/friends";
import { openInboxWS } from "@/lib/inbox_ws";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUserStore } from "@/stores/userStore";
import { NotificationToasts } from "@/components/notifications/NotificationToasts";
import { PushOptIn } from "@/components/notifications/PushOptIn";
import { StreakStartedPopup } from "@/components/notifications/StreakStartedPopup";

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
  const pushStreakStarted = useNotificationStore((s) => s.pushStreakStarted);
  const setLiveStreak = useNotificationStore((s) => s.setLiveStreak);

  // On garde une map fraîche des amis (peer_name + photo) pour pouvoir
  // enrichir les toasts entrants. Mise à jour au mount + sur les events
  // `removed` (le serveur a invalidé l'amitié → on re-fetch).
  const friendsRef = useRef<Map<number, FriendSummary>>(new Map());
  const pathnameRef = useRef(pathname);
  // cloudName en state pour que les toasts re-rendent quand on l'obtient
  // (sinon un toast rendu avant la résolution de fetchCloudName affiche
  // l'initiale en fallback en permanence). Le ref miroir évite de
  // re-déclencher l'effet WS sur chaque update du state.
  const [cloudName, setCloudName] = useState("");
  const cloudNameRef = useRef("");
  useEffect(() => {
    cloudNameRef.current = cloudName;
  }, [cloudName]);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // Ref miroir de notificationStore.activeFriendId — set par
  // FriendConversation à son mount, sert à gating les notifs.
  const activeFriendIdRef = useRef<number | null>(null);
  useEffect(() => {
    const unsub = useNotificationStore.subscribe((s) => {
      activeFriendIdRef.current = s.activeFriendId;
    });
    return unsub;
  }, []);

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
        if (cn) setCloudName(cn);
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
    // Retry du cloud name si le 1er fetch a échoué : sans ça, aucun toast
    // n'affichera la photo de profil pour le reste de la session.
    const ensureCloud = setInterval(() => {
      if (cancelled) return;
      if (cloudNameRef.current) return;
      fetchCloudName()
        .then((cn) => {
          if (!cancelled && cn) setCloudName(cn);
        })
        .catch(() => {});
    }, 15_000);

    const handle: { reconnect: () => void; close: () => void } = openInboxWS((ev) => {
      // Détection "conv ouverte" via le store global — set par
      // FriendConversation (inline ET /chats/[id] page utilisent le
      // même composant donc l'effet déclenche dans les deux cas).
      // Fallback URL au cas où FriendConversation pas encore monté.
      const activeId = activeFriendIdRef.current;
      const urlMatch = pathnameRef.current?.match(/^\/chats\/(\d+)/);
      const urlActiveId = urlMatch ? Number(urlMatch[1]) : null;
      const isTalkingTo = (fid: number) =>
        activeId === fid || urlActiveId === fid;

      if (ev.type === "msg") {
        if (!isTalkingTo(ev.friend_id)) {
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
                  streak: p.streak,
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
        if (isTalkingTo(ev.friend_id)) {
          // L'user discute déjà avec cet ami — pas besoin de toast,
          // le header sera mis à jour quand le profile sera re-fetch.
          return;
        }
        const cached = friendsRef.current.get(ev.friend_id);
        if (ev.streak === 2) {
          // Premier streak — popup centré 3s avec photo FRAÎCHE.
          // L'avatar caché pouvait être stale ; on va chercher le
          // profile pour récupérer la position 1 actuelle.
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
              pushStreakStarted({
                friendId: ev.friend_id,
                peerName: p.display_name || cached?.peer_name || "—",
                peerPhotoId: main ?? cached?.peer_photo_id,
                at: Date.now(),
              });
            })
            .catch(() => {
              pushStreakStarted({
                friendId: ev.friend_id,
                peerName: cached?.peer_name ?? "—",
                peerPhotoId: cached?.peer_photo_id,
                at: Date.now(),
              });
            });
        } else {
          pushToast({
            friendId: ev.friend_id,
            senderId: 0,
            peerName: cached?.peer_name ?? "—",
            peerPhotoId: cached?.peer_photo_id,
            preview: "",
            sentAt: new Date().toISOString(),
            milestone: ev.streak,
            streak: ev.streak,
          });
        }
      } else if (ev.type === "streak_update") {
        // Live bump du streak après un message (sans palier). On reflète
        // immédiatement la nouvelle valeur dans la liste d'amis et le
        // cache local — pas de toast (le bump est silencieux).
        setLiveStreak(ev.friend_id, ev.streak, ev.streak_at_risk);
        const cached = friendsRef.current.get(ev.friend_id);
        if (cached) {
          friendsRef.current.set(ev.friend_id, {
            ...cached,
            streak: ev.streak,
            streak_at_risk: ev.streak_at_risk,
          });
        }
      } else if (ev.type === "streak_restored") {
        // Rallume la flamme instantanément (header de conv + liste d'amis)
        // et resync les compteurs. Pas de toast ici : la ligne système
        // "streak restauré" postée dans le chat génère déjà une notif
        // (frame `msg`), exactement comme la perte.
        setLiveStreak(ev.friend_id, ev.streak, false);
        const cached = friendsRef.current.get(ev.friend_id);
        if (cached) {
          friendsRef.current.set(ev.friend_id, {
            ...cached,
            streak: ev.streak,
            streak_at_risk: false,
            lost_streak: 0,
          });
        }
        loadFriends();
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
      clearInterval(ensureCloud);
      handle.close();
    };
  }, [hydrated, user, hydrateUnread, incrementUnread, clearUnread, pushToast, pushStreakStarted, setLiveStreak]);

  if (!hydrated || !user) return null;
  return (
    <>
      <PushOptIn />
      <NotificationToasts cloudName={cloudName} />
      <StreakStartedPopup cloudName={cloudName} />
    </>
  );
}
