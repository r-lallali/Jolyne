"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FriendProfileModal } from "@/components/friends/FriendProfileModal";
import { cloudinaryUrl, fetchCloudName } from "@/lib/account";
import { FriendSummary, listFriends } from "@/lib/friends";
import { useT } from "@/lib/i18n";
import { useUserStore } from "@/stores/userStore";

// FriendsSidebar : rail conversations toujours visible à droite sur desktop
// (≥ lg). Sur mobile, bouton bulle bottom-right qui ouvre un drawer overlay.
//
// Polling /api/friends toutes les 15 s — le backend met automatiquement à
// jour `last_read_at` quand l'utilisateur ouvre un /ws/friend/{id}, donc
// la pastille « non lu » disparait au prochain refresh sans action UI.
const POLL_MS = 15_000;

export function FriendsSidebar() {
  const user = useUserStore((s) => s.user);
  const hydrated = useUserStore((s) => s.hydrated);
  const [friends, setFriends] = useState<FriendSummary[] | null>(null);
  const [cloud, setCloud] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileFriendID, setProfileFriendID] = useState<number | null>(null);

  useEffect(() => {
    if (!hydrated || !user) {
      setFriends(null);
      return;
    }
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const list = await listFriends();
        if (!stopped) setFriends(list);
      } catch {
        // silent — polling reprendra
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    fetchCloudName().then(setCloud).catch(() => {});
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [hydrated, user]);

  if (!hydrated || !user) return null;

  const totalUnread =
    friends?.reduce((acc, f) => acc + (f.unread_count ?? 0), 0) ?? 0;

  const body = (
    <SidebarBody
      friends={friends}
      cloud={cloud}
      onOpenProfile={(id) => {
        setProfileFriendID(id);
        setDrawerOpen(false);
      }}
      onPickRow={() => setDrawerOpen(false)}
    />
  );

  return (
    <>
      {/* Bouton bulle mobile (hidden sur lg+). Affiche un compteur global. */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-label="Conversations"
        className="fixed bottom-4 right-4 z-40 inline-flex size-12 items-center justify-center rounded-full bg-neutral-900 text-neutral-50 shadow-lg transition-transform hover:scale-105 dark:bg-neutral-100 dark:text-neutral-900 lg:hidden"
      >
        <ChatBubbleIcon />
        {totalUnread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {totalUnread > 9 ? "9+" : totalUnread}
          </span>
        )}
      </button>

      {/* Drawer mobile overlay. Click backdrop = close. */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={() => setDrawerOpen(false)}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-0 flex h-full w-80 max-w-[90vw] flex-col bg-white shadow-2xl dark:bg-neutral-950"
          >
            {body}
          </aside>
        </div>
      )}

      {/* Rail desktop fixe. */}
      <aside className="fixed inset-y-0 right-0 z-30 hidden w-80 flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 lg:flex">
        {body}
      </aside>

      {profileFriendID !== null && (
        <FriendProfileModal
          friendId={profileFriendID}
          cloudName={cloud}
          onClose={() => setProfileFriendID(null)}
        />
      )}
    </>
  );
}

function SidebarBody({
  friends,
  cloud,
  onOpenProfile,
  onPickRow,
}: {
  friends: FriendSummary[] | null;
  cloud: string;
  onOpenProfile: (friendID: number) => void;
  onPickRow: () => void;
}) {
  const t = useT();
  return (
    <>
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
          {t.chats.title}
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        {friends === null ? (
          <p className="px-5 py-6 text-xs text-neutral-500 dark:text-neutral-400">
            …
          </p>
        ) : friends.length === 0 ? (
          <p className="px-5 py-6 text-xs text-neutral-500 dark:text-neutral-400">
            {t.chats.empty}
          </p>
        ) : (
          <ul>
            {friends.map((f) => (
              <FriendRow
                key={f.id}
                friend={f}
                cloud={cloud}
                onOpenProfile={() => onOpenProfile(f.id)}
                onPickRow={onPickRow}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function FriendRow({
  friend,
  cloud,
  onOpenProfile,
  onPickRow,
}: {
  friend: FriendSummary;
  cloud: string;
  onOpenProfile: () => void;
  onPickRow: () => void;
}) {
  const hasUnread = friend.unread_count > 0;
  const peerName = friend.peer_name || "—";
  return (
    <li className="border-b border-neutral-100 last:border-b-0 dark:border-neutral-900">
      <div className="flex items-center gap-3 px-5 py-3">
        {/* Avatar : clickable → ouvre la modale profil. Bouton dédié pour
            ne pas piéger le tap de la ligne entière. */}
        <button
          type="button"
          onClick={onOpenProfile}
          aria-label={`Voir le profil de ${peerName}`}
          className="relative shrink-0 overflow-hidden rounded-full"
        >
          <span className="block size-11 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            {friend.peer_photo_id && cloud ? (
              <img
                src={cloudinaryUrl(cloud, friend.peer_photo_id, {
                  w: 128,
                  h: 128,
                })}
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
        {/* Ligne nom + last_message_at, click → ouvre la conv */}
        <Link
          href={`/chats/${friend.id}`}
          onClick={onPickRow}
          className="min-w-0 flex-1 py-1"
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
              "mt-0.5 truncate text-[11px] " +
              (hasUnread
                ? "font-semibold text-neutral-600 dark:text-neutral-300"
                : "text-neutral-500 dark:text-neutral-500")
            }
          >
            {relativeTime(friend.last_message_at)}
          </p>
        </Link>
      </div>
    </li>
  );
}

// relativeTime : "il y a 3 min" / "hier" / "5 mars". Format minimal pour
// rester compact dans la sidebar — pas de dépendance externe (intl natif).
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

function ChatBubbleIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
