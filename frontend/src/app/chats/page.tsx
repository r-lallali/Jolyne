"use client";

import Link from "next/link";
import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import { cloudinaryUrl, fetchCloudName } from "@/lib/account";
import { listFriends, type FriendSummary } from "@/lib/friends";
import { useT } from "@/lib/i18n";
import { useUserStore } from "@/stores/userStore";

export default function ChatsPage() {
  const t = useT();
  const user = useUserStore((s) => s.user);
  const hydrated = useUserStore((s) => s.hydrated);
  const [list, setList] = useState<FriendSummary[]>([]);
  const [cloud, setCloud] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hydrated || !user) return;
    Promise.all([listFriends(), fetchCloudName().catch(() => "")])
      .then(([fs, cn]) => {
        setList(fs);
        setCloud(cn);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [hydrated, user]);

  if (!hydrated) return null;
  if (!user) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link
        href="/"
        className="text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        ← {t.auth.backToApp}
      </Link>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
        {t.chats.title}
      </h1>

      {loading ? (
        <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">…</p>
      ) : list.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">
          {t.chats.empty}
        </p>
      ) : (
        <ul className="mt-6 space-y-1">
          {list.map((f) => (
            <li key={f.id}>
              <Link
                href={`/chats/${f.id}`}
                className="flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                <div className="size-12 shrink-0 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                  {f.peer_photo_id && cloud ? (
                    <img
                      src={cloudinaryUrl(cloud, f.peer_photo_id, {
                        w: 96,
                        h: 96,
                      })}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">
                    {f.peer_name || "—"}
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {new Date(f.last_message_at).toLocaleString("fr-FR")}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
