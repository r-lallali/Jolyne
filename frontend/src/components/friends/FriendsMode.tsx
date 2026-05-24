"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FriendConversation, RemoveConfirmModal } from "@/components/friends/FriendConversation";
import { FriendProfileModal } from "@/components/friends/FriendProfileModal";
import { cloudinaryUrl, fetchCloudName } from "@/lib/account";
import { FriendSummary, listFriends, removeFriend, reportFriend } from "@/lib/friends";
import { useT } from "@/lib/i18n";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUserStore } from "@/stores/userStore";
import { StreakBadge } from "@/components/friends/StreakBadge";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { FriendActionsMenu } from "@/components/friends/FriendActionsMenu";
import { ReportModal } from "@/components/chat/ReportModal";

// FriendsMode : vue "Mes conversations" rendue inline dans la home quand
// l'utilisateur bascule sur l'onglet droit (ModeTabs). Gère son propre
// état interne : list ↔ conversation, sans navigation full-page.
//
// `onUnreadChange` remonte le compteur global au parent (badge sur la bar
// de l'onglet).
// Polling de secours : l'inbox WS pousse les events en temps réel, ce poll
// sert uniquement de filet en cas de désync (WS coupé / msg manqué). 60s
// suffit largement pour cet usage et soulage DB + batterie mobile.
const POLL_MS = 60_000;

export function FriendsMode() {
  const t = useT();
  const [friends, setFriends] = useState<FriendSummary[] | null>(null);
  const [cloud, setCloud] = useState("");
  const [openFriendID, setOpenFriendID] = useState<number | null>(null);
  const [profileFriendID, setProfileFriendID] = useState<number | null>(null);
  const hydrateUnread = useNotificationStore((s) => s.hydrateUnread);

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
      // Consomme notre entrée d'historique UNIQUEMENT si on est toujours
      // dessus (= cas "friend retiré, setOpenFriendID(null) direct"). Si
      // Next.js a déjà router.push'é ailleurs (ex: clic sur "Mon compte"
      // depuis le menu avatar), `history.state.jolyne` n'est plus
      // "friend-inline" et appeler back() annulerait la navigation
      // utilisateur — bug observé en prod (clic "Mon compte" depuis une
      // conversation ramenait sur la home).
      if (
        pushedRef.current &&
        typeof window !== "undefined" &&
        window.history.state?.jolyne === "friend-inline"
      ) {
        pushedRef.current = false;
        window.history.back();
      } else {
        pushedRef.current = false;
      }
    };
  }, [openFriendID]);

  const preloadedRef = useRef<Set<string>>(new Set());
  const refresh = useCallback(async () => {
    try {
      const list = await listFriends();
      setFriends(list);
      // Sync l'unread store avec ce que le serveur dit (refresh polling
      // sert de filet : si le WS inbox a manqué un event, le poll corrige).
      const unread: Record<number, number> = {};
      for (const f of list) {
        if (f.unread_count > 0) unread[f.id] = f.unread_count;
      }
      hydrateUnread(unread);
    } catch {
      // silent
    }
  }, [hydrateUnread]);

  // Préchauffe le cache navigateur pour les photos de profil des amis dès
  // que la liste arrive : on évite le flash gris à l'ouverture d'une conv.
  useEffect(() => {
    if (!friends || !cloud) return;
    for (const f of friends) {
      if (!f.peer_photo_id) continue;
      const key = `${cloud}|${f.peer_photo_id}`;
      if (preloadedRef.current.has(key)) continue;
      preloadedRef.current.add(key);
      const img = new Image();
      img.src = cloudinaryUrl(cloud, f.peer_photo_id, { w: 96, h: 96 });
    }
  }, [friends, cloud]);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      await refresh();
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    fetchCloudName().then(setCloud).catch(() => {});
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [refresh]);

  // Vue conversation : prend toute la place dispo. Le back-button du
  // FriendConversation rappelle setOpenFriendID(null) → on retombe sur
  // la liste sans avoir à naviguer.
  if (openFriendID !== null) {
    return (
      <div className="h-dvh w-full sm:h-[92vh]" data-no-swipe>
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

  // Vue liste. `self-start` casse le centrage vertical du wrapper home
  // (`sm:items-center`) — sinon la liste se retrouve au milieu du viewport
  // sur desktop. Padding-top intègre la safe area iOS + ~3.5rem pour
  // dégager les ModeTabs / cluster avatar.
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col self-start px-4 pt-[calc(env(safe-area-inset-top)+3.5rem)] sm:px-6 sm:pt-12">
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
                onRefresh={refresh}
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
  onRefresh,
}: {
  friend: FriendSummary;
  cloud: string;
  onOpen: () => void;
  onOpenProfile: () => void;
  onRefresh: () => void;
}) {
  const t = useT();
  const me = useUserStore((s) => s.user);
  const hasUnread = friend.unread_count > 0;
  const peerName = friend.peer_name || "—";
  const isMine = me && friend.last_message_sender_id === me.id;

  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setMuted(localStorage.getItem(`jolyne:muted_friend_${friend.id}`) === "1");
  }, [friend.id]);

  const toggleMute = () => {
    setMuted((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.setItem(`jolyne:muted_friend_${friend.id}`, "1");
        else localStorage.removeItem(`jolyne:muted_friend_${friend.id}`);
      } catch {
        // silent
      }
      return next;
    });
    setMenuOpen(false);
  };

  const submitReport = async (reason: string) => {
    try {
      await reportFriend(friend.id, reason);
      onRefresh();
    } catch {
      // silent
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    setMenuOpen(false);
    try {
      await removeFriend(friend.id);
      onRefresh();
    } catch {
      // silent
    }
  };

  // Preview style Instagram : "Toi : salut" si je suis l'auteur, sinon
  // le body brut. Message supprimé → on affiche le placeholder en italique
  // (le body remonté du backend est déjà vidé dans ce cas).
  let preview = "";
  if (friend.last_message_deleted) {
    preview = t.chats.deletedPlaceholder;
  } else if (friend.last_message_body) {
    preview = isMine
      ? `Toi : ${friend.last_message_body}`
      : friend.last_message_body;
  }
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
          <div className="flex items-center gap-1.5 min-w-0">
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
            {friend.peer_verified && (
              <span className="shrink-0 text-emerald-500 dark:text-emerald-400" title="Profil Vérifié">
                <VerifiedBadge className="size-3.5" />
              </span>
            )}
            <StreakBadge
              streak={friend.streak}
              atRisk={friend.streak_at_risk}
              lostStreak={friend.lost_streak}
              size="md"
            />
            {muted && (
              <span className="shrink-0 text-neutral-400 dark:text-neutral-500" title="Sourdine active">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-3"
                  aria-hidden
                >
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                  <path d="M3 3l18 18" />
                </svg>
              </span>
            )}
          </div>
          <span className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
            {relativeTime(friend.last_message_at)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p
            className={
              "truncate text-xs " +
              (friend.last_message_deleted
                ? "italic text-neutral-400 dark:text-neutral-500"
                : hasUnread
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
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={t.chats.menuLabel || "Menu d'actions"}
          className="inline-flex size-8 items-center justify-center rounded-full text-neutral-500 opacity-0 transition-all hover:bg-neutral-100 hover:text-neutral-900 active:scale-90 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          <DotsIcon />
        </button>
        {menuOpen && (
          <FriendActionsMenu
            muted={muted}
            onToggleMute={toggleMute}
            onReport={() => {
              setMenuOpen(false);
              setReportOpen(true);
            }}
            onRemove={() => {
              setMenuOpen(false);
              setConfirmRemove(true);
            }}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </div>

      <ReportModal
        open={reportOpen}
        peerNick={peerName}
        onClose={() => setReportOpen(false)}
        onSubmit={submitReport}
      />
      <RemoveConfirmModal
        open={confirmRemove}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={remove}
      />
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

function DotsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
      aria-hidden
    >
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </svg>
  );
}
