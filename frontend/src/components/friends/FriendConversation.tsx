"use client";

import { useEffect, useRef, useState } from "react";
import { cloudinaryUrl, fetchCloudName } from "@/lib/account";
import {
  FriendMessage,
  FriendProfile,
  getFriendProfile,
  removeFriend,
} from "@/lib/friends";
import { openFriendWS, FriendWSHandle } from "@/lib/friend_ws";
import { useT } from "@/lib/i18n";
import { isPromptKey } from "@/lib/prompts";
import { useUserStore } from "@/stores/userStore";

// FriendConversation : UI complète d'un chat persisté entre amis.
// Réutilisable : embarquée inline dans FriendsMode (toggle home) ou dans
// la page dédiée /chats/[id]. Le callback `onBack` permet à l'embeddeur
// de retourner à sa liste (vs navigation full-page sur la route dédiée).
export function FriendConversation({
  friendId,
  onBack,
  onLeft,
  onOpenProfile,
}: {
  friendId: number;
  onBack: () => void;
  // Appelé quand la convo se ferme définitivement (peer retiré + suppression
  // confirmée par l'utilisateur). Permet à FriendsMode de retomber sur la
  // liste sans navigation full-page.
  onLeft?: () => void;
  // Si fourni, l'avatar du header devient cliquable et appelle ce callback.
  onOpenProfile?: () => void;
}) {
  const t = useT();
  const user = useUserStore((s) => s.user);
  const hydrated = useUserStore((s) => s.hydrated);
  const [profile, setProfile] = useState<FriendProfile | null>(null);
  const [cloud, setCloud] = useState("");
  const [msgs, setMsgs] = useState<FriendMessage[]>([]);
  const [peerRemovedMe, setPeerRemovedMe] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<FriendWSHandle | null>(null);

  useEffect(() => {
    if (!hydrated || !user || !Number.isFinite(friendId)) return;
    Promise.all([getFriendProfile(friendId), fetchCloudName().catch(() => "")])
      .then(([p, cn]) => {
        setProfile(p);
        setCloud(cn);
      })
      .catch(() => {});
  }, [hydrated, user, friendId]);

  useEffect(() => {
    if (!hydrated || !user || !Number.isFinite(friendId)) return;
    const handle = openFriendWS(friendId, (ev) => {
      switch (ev.type) {
        case "history":
          setMsgs(ev.messages ?? []);
          break;
        case "msg":
          setMsgs((prev) =>
            prev.some((m) => m.id === ev.msg.id) ? prev : [...prev, ev.msg],
          );
          break;
        case "peer_removed":
          setPeerRemovedMe(true);
          break;
        case "error":
          break;
      }
    });
    wsRef.current = handle;
    return () => {
      handle.close();
      wsRef.current = null;
    };
  }, [hydrated, user, friendId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [msgs.length]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending || !wsRef.current) return;
    setSending(true);
    try {
      wsRef.current.send(body);
      setDraft("");
    } finally {
      setSending(false);
    }
  };

  const remove = async () => {
    if (!confirm(t.chats.removeConfirm)) return;
    try {
      await removeFriend(friendId);
      onLeft?.();
      onBack();
    } catch {
      // silent
    }
  };

  if (!hydrated) return null;
  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {t.auth.loginCta}
        </p>
      </main>
    );
  }

  const mainPhoto =
    profile?.photos.find((p) => p.position === 1)?.public_id ??
    profile?.photos[0]?.public_id;
  const initial = (profile?.display_name ?? "").slice(0, 1).toUpperCase();

  return (
    <div className="flex h-full w-full flex-col sm:mx-auto sm:max-w-2xl">
      <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          ← {t.chats.back}
        </button>
        <button
          type="button"
          onClick={onOpenProfile}
          disabled={!onOpenProfile}
          aria-label={profile?.display_name || ""}
          className="ml-2 inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-200 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
        >
          {mainPhoto && cloud ? (
            <img
              src={cloudinaryUrl(cloud, mainPhoto, { w: 96, h: 96 })}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            initial || null
          )}
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">
          {profile?.display_name || "—"}
        </p>
        <button
          type="button"
          onClick={remove}
          title={t.chats.remove}
          className="rounded-full px-2 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-red-600 dark:text-neutral-600 dark:hover:bg-neutral-900 dark:hover:text-red-400"
        >
          ⋯
        </button>
      </header>

      <div
        ref={scrollRef}
        className="scrollbar-discreet flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto w-full max-w-2xl space-y-2 px-4 py-4 sm:px-6">
          {profile?.bio && (
            <p className="mb-3 rounded-2xl bg-neutral-100/60 px-4 py-3 text-xs italic text-neutral-600 dark:bg-neutral-900/50 dark:text-neutral-400">
              {profile.bio}
            </p>
          )}
          {profile?.prompts &&
            profile.prompts.some((p) => p.prompt && p.answer) && (
              <div className="mb-4 space-y-2">
                {profile.prompts
                  .filter((p) => p.prompt && p.answer)
                  .map((p, i) => (
                    <PromptCard
                      key={i}
                      promptKey={p.prompt}
                      answer={p.answer}
                    />
                  ))}
              </div>
            )}
          {msgs.map((m) => {
            const mine = user && m.sender_id === user.id;
            return (
              <div
                key={m.id}
                className={`flex w-full ${mine ? "justify-end" : "justify-start"}`}
              >
                <p
                  title={new Date(m.sent_at).toLocaleString("fr-FR")}
                  className={
                    "max-w-[78%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug " +
                    (mine
                      ? "rounded-br-sm bg-neutral-900 text-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
                      : "rounded-bl-sm bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100")
                  }
                >
                  {m.body}
                </p>
              </div>
            );
          })}
          {peerRemovedMe && (
            <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-center dark:border-neutral-800 dark:bg-neutral-900/60">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                {t.friendChat.peerRemovedTitle}
              </p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                {t.friendChat.peerRemovedHint}
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={onBack}
                  className="rounded-full bg-neutral-100 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                >
                  {t.friendChat.keepConversation}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(t.friendChat.deleteConfirm)) return;
                    try {
                      await removeFriend(friendId);
                      onLeft?.();
                      onBack();
                    } catch {}
                  }}
                  className="rounded-full bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-700"
                >
                  {t.friendChat.deleteConversation}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {!peerRemovedMe && (
        <form
          onSubmit={send}
          className="px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
        >
          <div className="mx-auto flex w-full max-w-2xl items-center gap-2 rounded-2xl bg-neutral-100 px-4 py-1.5 ring-1 ring-transparent transition-all focus-within:ring-neutral-300 dark:bg-neutral-900 dark:focus-within:ring-neutral-700">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t.chats.placeholder}
              maxLength={2000}
              className="flex-1 bg-transparent py-2.5 text-[15px] text-neutral-900 placeholder:text-neutral-500 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500"
            />
            <button
              type="submit"
              disabled={sending || draft.trim().length === 0}
              aria-label={t.chats.send}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-neutral-100 transition-all hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-25 dark:bg-neutral-100 dark:text-neutral-900"
            >
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function PromptCard({
  promptKey,
  answer,
}: {
  promptKey: string;
  answer: string;
}) {
  const t = useT();
  const label = isPromptKey(promptKey) ? t.prompts[promptKey] : promptKey;
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-900 dark:text-neutral-100">
        {answer}
      </p>
    </div>
  );
}
