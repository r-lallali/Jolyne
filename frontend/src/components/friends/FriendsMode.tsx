"use client";

import { useEffect, useRef, useState } from "react";
import { FriendConversation } from "@/components/friends/FriendConversation";
import { FriendProfileModal } from "@/components/friends/FriendProfileModal";
import { cloudinaryUrl, fetchCloudName } from "@/lib/account";
import { FriendSummary, listFriends } from "@/lib/friends";
import { useT } from "@/lib/i18n";
import { useUserStore } from "@/stores/userStore";

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

  // Vue liste. `pt-10` (40px) suffit pour passer sous ModeTabs (~24px) —
  // l'ancien `pt-20` laissait une bande vide trop visible.
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col px-4 pt-10 sm:px-6">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
        {t.chats.title}
      </h1>
      <div className="mt-3">
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
  const me = useUserStore((s) => s.user);
  const hasUnread = friend.unread_count > 0;
  const peerName = friend.peer_name || "—";
  const isMine = me && friend.last_message_sender_id === me.id;
  // Preview style Instagram : "Toi: salut" si je suis l'auteur, sinon
  // le body brut. Si aucun message, on rentre dans le fallback "—".
  const preview = friend.last_message_body
    ? isMine
      ? `Toi : ${friend.last_message_body}`
      : friend.last_message_body
    : "";
  return (
    <li className="group flex items-center gap-3 py-2.5">
      <button
        type="button"
        onClick={onOpenProfile}
        aria-label={`Voir le profil de ${peerName}`}
        className="shrink-0 transition-transform active:scale-95"
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
        <div className="flex items-baseline justify-between gap-2">
          <p
            className={
              "truncate text-sm " +
              (hasUnread
                ? "font-semibold text-neutral-900 dark:text-neutral-50"
                : "font-medium text-neutral-800 dark:text-neutral-200")
            }
          >
            {peerName}
          </p>
          <span className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
            {relativeTime(friend.last_message_at)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p
            className={
              "truncate text-xs " +
              (hasUnread
                ? "font-semibold text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-500")
            }
          >
            {preview}
          </p>
          {hasUnread && (
            <span
              aria-label={`${friend.unread_count} non lu(s)`}
              className="inline-flex h-2 w-2 shrink-0 rounded-full bg-emerald-500"
            />
          )}
        </div>
      </button>
    </li>
  );
}

// relativeTime : format type Instagram en français
// ("à l'instant", "il y a 5 min", "il y a 6 h", "il y a 4 j", "12 mars").
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t || isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d} j`;
  return new Date(t).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}
