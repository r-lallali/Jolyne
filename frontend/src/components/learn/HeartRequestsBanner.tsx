"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { listFriends } from "@/lib/friends";
import { grantHeart, listHeartRequests, type HeartRequest } from "@/lib/learn";

// Bannière affichée quand des amis ont demandé un cœur : on les liste et on
// peut leur en offrir un. Le nom du demandeur est résolu via la liste d'amis
// (les demandes ne portent que l'ID).
export function HeartRequestsBanner({ onChanged }: { onChanged: () => void }) {
  const t = useT();
  const [requests, setRequests] = useState<HeartRequest[]>([]);
  const [names, setNames] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listHeartRequests(), listFriends().catch(() => [])])
      .then(([reqs, friends]) => {
        if (cancelled) return;
        setRequests(reqs);
        const map: Record<number, string> = {};
        for (const f of friends) map[f.peer_id] = f.peer_name;
        setNames(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const give = async (id: number) => {
    if (busyId !== null) return;
    setBusyId(id);
    try {
      await grantHeart(id);
      setRequests((rs) => rs.filter((r) => r.id !== id));
      onChanged();
    } catch {
      // silencieux
    } finally {
      setBusyId(null);
    }
  };

  if (requests.length === 0) return null;

  return (
    <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
      <p className="mb-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
        {t.learn.incomingHearts({ count: requests.length })}
      </p>
      <ul className="flex flex-col gap-1">
        {requests.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-2 text-sm text-neutral-800 dark:text-neutral-200"
          >
            <span className="truncate">
              {names[r.requester_id] ?? `#${r.requester_id}`}
            </span>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => give(r.id)}
              className="shrink-0 rounded-full bg-rose-500 px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              ❤️ {t.learn.giveHeart}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
