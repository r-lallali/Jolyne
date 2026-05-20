"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { cloudinaryUrl, fetchCloudName } from "@/lib/account";
import {
  FriendMessage,
  FriendProfile,
  getFriendMessages,
  getFriendProfile,
  postFriendMessage,
  removeFriend,
} from "@/lib/friends";
import { useT } from "@/lib/i18n";
import { isPromptKey } from "@/lib/prompts";
import { useUserStore } from "@/stores/userStore";

// Polling : on rafraichit toutes les 4s tant que l'onglet est focus.
const POLL_MS = 4_000;

export default function FriendChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = use(params);
  const id = Number(idStr);
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

  useEffect(() => {
    if (!hydrated || !user || !Number.isFinite(id)) return;
    Promise.all([getFriendProfile(id), fetchCloudName().catch(() => "")])
      .then(([p, cn]) => {
        setProfile(p);
        setCloud(cn);
      })
      .catch(() => {});
  }, [hydrated, user, id]);

  // Polling messages — pauseable via document.hidden.
  useEffect(() => {
    if (!hydrated || !user || !Number.isFinite(id)) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const fresh = await getFriendMessages(id);
        if (!stopped) {
          setMsgs(fresh.messages);
          setPeerRemovedMe(fresh.peer_removed_me);
        }
      } catch {
        // silent
      }
    };
    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [hydrated, user, id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [msgs.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const m = await postFriendMessage(id, body);
      setMsgs((prev) => [...prev, m]);
      setDraft("");
    } finally {
      setSending(false);
    }
  };

  const remove = async () => {
    if (!confirm(t.chats.removeConfirm)) return;
    try {
      await removeFriend(id);
      window.location.href = "/chats";
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

  const mainPhoto = profile?.photos.find((p) => p.position === 1)?.public_id
    ?? profile?.photos[0]?.public_id;

  return (
    <main className="flex h-dvh w-full flex-col sm:mx-auto sm:max-w-2xl">
      <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Link
          href="/chats"
          className="text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          ← {t.chats.back}
        </Link>
        <div className="ml-2 size-9 shrink-0 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          {mainPhoto && cloud ? (
            <img
              src={cloudinaryUrl(cloud, mainPhoto, { w: 96, h: 96 })}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
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
          {profile?.prompts && profile.prompts.some((p) => p.prompt && p.answer) && (
            <div className="mb-4 space-y-2">
              {profile.prompts
                .filter((p) => p.prompt && p.answer)
                .map((p, i) => (
                  <PromptCard key={i} promptKey={p.prompt} answer={p.answer} />
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
                <Link
                  href="/chats"
                  className="rounded-full bg-neutral-100 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                >
                  {t.friendChat.keepConversation}
                </Link>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(t.friendChat.deleteConfirm)) return;
                    try {
                      await removeFriend(id);
                      window.location.href = "/chats";
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
    </main>
  );
}

function PromptCard({ promptKey, answer }: { promptKey: string; answer: string }) {
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
