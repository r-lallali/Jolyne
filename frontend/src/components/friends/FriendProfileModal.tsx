"use client";

import { useEffect, useState } from "react";
import { cloudinaryUrl } from "@/lib/account";
import { FriendProfile, getFriendProfile } from "@/lib/friends";
import { useT } from "@/lib/i18n";
import { isPromptKey } from "@/lib/prompts";

// FriendProfileModal : modale plein écran qui montre le profil complet
// d'un ami — photos (carousel horizontal), bio, prompts. Click backdrop
// ou Escape pour fermer.
export function FriendProfileModal({
  friendId,
  cloudName,
  onClose,
}: {
  friendId: number;
  cloudName: string;
  onClose: () => void;
}) {
  const t = useT();
  const [profile, setProfile] = useState<FriendProfile | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let stopped = false;
    getFriendProfile(friendId)
      .then((p) => {
        if (!stopped) setProfile(p);
      })
      .catch(() => {
        if (!stopped) setErr(true);
      });
    return () => {
      stopped = true;
    };
  }, [friendId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-neutral-950"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="absolute right-3 top-3 z-10 inline-flex size-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60"
        >
          ✕
        </button>
        <div className="flex-1 overflow-y-auto">
          {err ? (
            <p className="px-6 py-12 text-center text-sm text-neutral-500 dark:text-neutral-400">
              —
            </p>
          ) : !profile ? (
            <div className="aspect-square w-full animate-pulse bg-neutral-100 dark:bg-neutral-900" />
          ) : (
            <ProfileBody profile={profile} cloudName={cloudName} />
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileBody({
  profile,
  cloudName,
}: {
  profile: FriendProfile;
  cloudName: string;
}) {
  const t = useT();
  const photos = [...profile.photos].sort((a, b) => a.position - b.position);
  const visiblePrompts = profile.prompts.filter((p) => p.prompt && p.answer);
  const age = ageFromISO(profile.birthdate);

  return (
    <div>
      {/* Carrousel photos : snap horizontal. La première est l'avatar
          principal. Si aucune photo, on affiche un placeholder neutre. */}
      {photos.length > 0 ? (
        <div className="scrollbar-discreet flex snap-x snap-mandatory overflow-x-auto">
          {photos.map((ph) => (
            <img
              key={ph.position}
              src={cloudinaryUrl(cloudName, ph.public_id, { w: 720, h: 720 })}
              alt=""
              className="aspect-square w-full shrink-0 snap-center object-cover"
            />
          ))}
        </div>
      ) : (
        <div className="aspect-square w-full bg-neutral-100 dark:bg-neutral-900" />
      )}

      <div className="space-y-4 p-6">
        <header>
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
            {profile.display_name || "—"}
            {age !== null && (
              <span className="ml-2 text-neutral-500 dark:text-neutral-400">
                · {age}
              </span>
            )}
          </h2>
        </header>

        {profile.bio && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
            {profile.bio}
          </p>
        )}

        {visiblePrompts.length > 0 && (
          <div className="space-y-2">
            {visiblePrompts.map((p, i) => (
              <div
                key={i}
                className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-800"
              >
                <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  {isPromptKey(p.prompt) ? t.prompts[p.prompt] : p.prompt}
                </p>
                <p className="mt-1 whitespace-pre-wrap font-serif text-base text-neutral-900 dark:text-neutral-100">
                  {p.answer}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ageFromISO(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}
