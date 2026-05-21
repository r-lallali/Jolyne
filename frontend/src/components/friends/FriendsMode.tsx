"use client";

import { useEffect, useRef, useState } from "react";
import { FriendConversation } from "@/components/friends/FriendConversation";
import { FriendProfileModal } from "@/components/friends/FriendProfileModal";
import { cloudinaryUrl, fetchCloudName } from "@/lib/account";
import { FriendSummary, listFriends } from "@/lib/friends";
import { useT } from "@/lib/i18n";

// FriendsMode : vue "Mes conversations" rendue inline dans la home quand
// l'utilisateur bascule sur l'onglet droit (ModeTabs). Gère son propre
// état interne : list ↔ conversation, sans navigation full-page.
//
// `onUnreadChange` remonte le compteur global au parent (badge sur la bar
// de l'onglet).
const POLL_MS = 15_000;

export function FriendsMode({
  onUnreadChange,
}: {
  onUnreadChange?: (n: number) => void;
}) {
  const t = useT();
  const [friends, setFriends] = useState<FriendSummary[] | null>(null);
  const [cloud, setCloud] = useState("");
  const [openFriendID, setOpenFriendID] = useState<number | null>(null);
  const [profileFriendID, setProfileFriendID] = useState<number | null>(null);

  // Back navigateur : on push un état leurre quand on ouvre une conv
  // inline. Au popstate (bouton retour navigateur OU geste swipe iOS), on
  // referme. Le BackButton du header appelle aussi history.back(), donc
  // c'est le même chemin — un seul handler pour les deux gestes.
  const pushedRef = useRef(false);
  useEffect(() => {
    if (openFriendID === null) return;
    window.history.pushState({ jolyne: "friend-inline" }, "", window.location.href);
    pushedRef.current = true;
    const onPop = () => {
      pushedRef.current = false;
      setOpenFriendID(null);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Si on quitte la conv autrement que par popstate (ex: friend retiré
      // → setOpenFriendID(null) direct), on doit consommer notre entrée
      // d'historique pour ne pas la laisser derrière nous.
      if (pushedRef.current) {
        pushedRef.current = false;
        window.history.back();
      }
    };
  }, [openFriendID]);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const list = await listFriends();
        if (stopped) return;
        setFriends(list);
        if (onUnreadChange) {
          const total = list.reduce((acc, f) => acc + (f.unread_count ?? 0), 0);
          onUnreadChange(total);
        }
      } catch {
        // silent
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    fetchCloudName().then(setCloud).catch(() => {});
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [onUnreadChange]);

  // Vue conversation : prend toute la place dispo. Le back-button du
  // FriendConversation rappelle setOpenFriendID(null) → on retombe sur
  // la liste sans avoir à naviguer.
  if (openFriendID !== null) {
    return (
      <div className="h-dvh w-full sm:h-[92vh]">
        <FriendConversation
          friendId={openFriendID}
          onBack={() => window.history.back()}
          onLeft={() => setOpenFriendID(null)}
          onOpenProfile={() => setProfileFriendID(openFriendID)}
        />
        {profileFriendID !== null && (
          <FriendProfileModal
            friendId={profileFriendID}
            cloudName={cloud}
            onClose={() => setProfileFriendID(null)}
          />
        )}
      </div>
    );
  }

  // Vue liste.
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col px-4 pt-20 sm:px-6">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
        {t.chats.title}
      </h1>
      <div className="mt-4">
        {friends === null ? (
          <p className="py-6 text-sm text-neutral-500 dark:text-neutral-400">
            …
          </p>
        ) : friends.length === 0 ? (
          <p className="py-6 text-sm text-neutral-500 dark:text-neutral-400">
            {t.chats.empty}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-900">
            {friends.map((f) => (
              <FriendRow
                key={f.id}
                friend={f}
                cloud={cloud}
                onOpen={() => setOpenFriendID(f.id)}
                onOpenProfile={() => setProfileFriendID(f.id)}
              />
            ))}
          </ul>
        )}
      </div>
      {profileFriendID !== null && (
        <FriendProfileModal
          friendId={profileFriendID}
          cloudName={cloud}
          onClose={() => setProfileFriendID(null)}
        />
      )}
    </main>
  );
}

function FriendRow({
  friend,
  cloud,
  onOpen,
  onOpenProfile,
}: {
  friend: FriendSummary;
  cloud: string;
  onOpen: () => void;
  onOpenProfile: () => void;
}) {
  const hasUnread = friend.unread_count > 0;
  const peerName = friend.peer_name || "—";
  return (
    <li className="flex items-center gap-3 py-3">
      <button
        type="button"
        onClick={onOpenProfile}
        aria-label={`Voir le profil de ${peerName}`}
        className="shrink-0"
      >
        <span className="block size-12 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          {friend.peer_photo_id && cloud ? (
            <img
              src={cloudinaryUrl(cloud, friend.peer_photo_id, { w: 128, h: 128 })}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-sm font-semibold text-neutral-500 dark:text-neutral-400">
              {peerName.slice(0, 1).toUpperCase()}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 py-1 text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <p
            className={
              "truncate text-sm " +
              (hasUnread
                ? "font-bold text-neutral-900 dark:text-neutral-50"
                : "font-medium text-neutral-700 dark:text-neutral-300")
            }
          >
            {peerName}
          </p>
          {hasUnread && (
            <span
              aria-label={`${friend.unread_count} non lu(s)`}
              className="inline-flex h-2 w-2 shrink-0 rounded-full bg-emerald-500"
            />
          )}
        </div>
        <p
          className={
            "mt-0.5 truncate text-xs " +
            (hasUnread
              ? "font-semibold text-neutral-600 dark:text-neutral-300"
              : "text-neutral-500 dark:text-neutral-500")
          }
        >
          {relativeTime(friend.last_message_at)}
        </p>
      </button>
    </li>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t || isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} j`;
  return new Date(t).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}
