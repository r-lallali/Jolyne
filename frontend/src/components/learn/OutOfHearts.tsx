"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import { listFriends, type FriendSummary } from "@/lib/friends";
import { requestHeart, type LearnState } from "@/lib/learn";

// Écran « plus de vies » : trois issues — demander un cœur à un ami (1/jour),
// passer premium (cœurs illimités), ou attendre la régénération. Overlay
// plein écran affiché à 0 cœur (au lancement OU en interruption de leçon).
export function OutOfHearts({
  state,
  onClose,
  onGoPremium,
  onChanged,
}: {
  state: LearnState;
  onClose: () => void;
  onGoPremium: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  const [friends, setFriends] = useState<FriendSummary[] | null>(null);
  const [sent, setSent] = useState(false);
  const [quota, setQuota] = useState(!state.can_ask_heart);
  const [busy, setBusy] = useState(false);

  const regenMins = Math.ceil(state.next_heart_in_sec / 60);

  const openPicker = async () => {
    setPicking(true);
    if (friends === null) {
      try {
        setFriends(await listFriends());
      } catch {
        setFriends([]);
      }
    }
  };

  const ask = async (friendUserId: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await requestHeart(friendUserId);
      if (ok) {
        setSent(true);
        onChanged();
      } else {
        setQuota(true);
      }
    } catch {
      // silencieux
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-white px-6 text-center dark:bg-neutral-950">
      <button
        type="button"
        onClick={onClose}
        aria-label={t.common.close}
        className="absolute left-4 top-[calc(env(safe-area-inset-top)+0.75rem)] text-2xl leading-none text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
      >
        ✕
      </button>

      <div className="text-6xl">💔</div>
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        {t.learn.outOfHeartsTitle}
      </h1>
      <p className="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
        {t.learn.outOfHeartsHint}
      </p>

      {sent ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          {t.learn.requestSent}
        </p>
      ) : picking ? (
        <div className="w-full max-w-sm">
          {friends === null ? (
            <p className="text-sm text-neutral-400">…</p>
          ) : friends.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {t.learn.noFriends}
            </p>
          ) : (
            <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
              {friends.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => ask(f.peer_id)}
                    className="flex w-full items-center justify-between rounded-xl border border-neutral-200 px-4 py-3 text-left text-sm font-medium text-neutral-900 transition-colors hover:border-emerald-400 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-50"
                  >
                    <span className="truncate">{f.peer_name}</span>
                    <span className="shrink-0 text-rose-500">❤️</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex w-full max-w-xs flex-col gap-2">
          {quota ? (
            <p className="rounded-xl bg-neutral-100 px-4 py-3 text-sm text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
              {t.learn.requestQuota}
            </p>
          ) : (
            <button
              type="button"
              onClick={openPicker}
              className="rounded-xl border-2 border-rose-300 py-3 text-sm font-bold text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
            >
              ❤️ {t.learn.askFriend}
            </button>
          )}
          <button
            type="button"
            onClick={onGoPremium}
            className="rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 py-3 text-sm font-bold text-amber-950 shadow-sm transition-opacity hover:opacity-90"
          >
            💛 {t.learn.goPremium}
          </button>
        </div>
      )}

      {state.next_heart_in_sec > 0 && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          {t.learn.heartsRegen({ mins: regenMins })}
        </p>
      )}
    </div>
  );
}
