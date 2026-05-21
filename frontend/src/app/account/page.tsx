"use client";

import { AnimatePresence, motion } from "framer-motion";
import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import { PhotoSlot, replacePhoto } from "@/components/account/PhotoSlot";
import { BackButton } from "@/components/ui/BackButton";
import { PromptSlot } from "@/components/account/PromptSlot";
import {
  AccountDTO,
  PromptDTO,
  fetchAccount,
  fetchCloudName,
  updateAccount,
} from "@/lib/account";
import { useT } from "@/lib/i18n";
import { useUserStore } from "@/stores/userStore";

const MAX_PHOTOS = 6;

export default function AccountPage() {
  const t = useT();
  const user = useUserStore((s) => s.user);
  const hydrated = useUserStore((s) => s.hydrated);

  const [account, setAccount] = useState<AccountDTO | null>(null);
  const [cloudName, setCloudName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [savingState, setSavingState] = useState<"idle" | "busy" | "saved">(
    "idle",
  );
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [prompts, setPrompts] = useState<[PromptDTO, PromptDTO, PromptDTO]>([
    { prompt: "", answer: "" },
    { prompt: "", answer: "" },
    { prompt: "", answer: "" },
  ]);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) return;
    Promise.all([fetchAccount(), fetchCloudName().catch(() => "")])
      .then(([acc, cn]) => {
        setAccount(acc);
        setCloudName(cn);
        setDisplayName(acc.profile.display_name);
        setBio(acc.profile.bio);
        setBirthdate(acc.profile.birthdate ?? "");
        if (acc.profile.prompts) {
          setPrompts([
            { ...acc.profile.prompts[0] },
            { ...acc.profile.prompts[1] },
            { ...acc.profile.prompts[2] },
          ]);
        }
      })
      .catch(() => {
        // silent — la page reste vide, le user voit l'état initial
      })
      .finally(() => setLoading(false));
  }, [hydrated, user]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingState("busy");
    try {
      const updated = await updateAccount({
        display_name: displayName,
        bio,
        birthdate: birthdate || null,
        prompts,
      });
      setAccount(updated);
      setSavingState("saved");
      setTimeout(() => setSavingState("idle"), 1500);
    } catch {
      setSavingState("idle");
    }
  };

  if (!hydrated) {
    return null;
  }
  if (!user) {
    // Page strictement auth-only : on déclenche une vraie 404 pour les
    // visiteurs non connectés (au lieu d'un message inline qui laissait
    // exister une page vide). Comportement attendu par le user.
    notFound();
  }
  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">…</p>
      </main>
    );
  }

  const photos = account?.photos ?? [];
  const photoByPos = new Map(photos.map((p) => [p.position, p]));

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <BackButton href="/" label={t.auth.backToApp} />

      <h1 className="mt-4 text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
        {t.account.title}
      </h1>
      <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span className="truncate">{user.email}</span>
        {!user.email_verified && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
            {t.auth.notVerifiedBadge}
          </span>
        )}
      </div>

      <section className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {t.account.photos}
        </h2>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
          {t.account.photosHint}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: MAX_PHOTOS }).map((_, i) => {
            const pos = i + 1;
            const photo = photoByPos.get(pos);
            return (
              <PhotoSlot
                key={pos}
                position={pos}
                publicId={photo?.public_id}
                cloudName={cloudName}
                onUploaded={(publicId) => {
                  setAccount((prev) =>
                    prev
                      ? {
                          ...prev,
                          photos: replacePhoto(prev.photos, pos, publicId),
                        }
                      : prev,
                  );
                }}
                onDeleted={() => {
                  setAccount((prev) =>
                    prev
                      ? { ...prev, photos: prev.photos.filter((p) => p.position !== pos) }
                      : prev,
                  );
                }}
              />
            );
          })}
        </div>
      </section>

      <form onSubmit={save} className="mt-10 space-y-4">
        <Field label={t.account.displayName}>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t.account.displayNamePlaceholder}
            maxLength={40}
            className="w-full rounded-xl bg-neutral-100 px-4 py-3 text-base text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-700"
          />
        </Field>
        <Field label={t.account.bio}>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder={t.account.bioPlaceholder}
            maxLength={280}
            rows={3}
            className="w-full resize-none rounded-xl bg-neutral-100 px-4 py-3 text-base text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-700"
          />
        </Field>
        <Field label={t.account.birthdate}>
          <input
            type="date"
            value={birthdate}
            onChange={(e) => setBirthdate(e.target.value)}
            className="w-full rounded-xl bg-neutral-100 px-4 py-3 text-base text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-700"
          />
        </Field>

        <section className="pt-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            {t.account.prompts}
          </h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
            {t.account.promptsHint}
          </p>
          <div className="mt-3 space-y-3">
            {prompts.map((slot, idx) => (
              <PromptSlot
                key={idx}
                slot={slot}
                taken={prompts
                  .map((p, i) => (i === idx ? "" : p.prompt))
                  .filter((k) => k !== "")}
                onChange={(next) => {
                  setPrompts((prev) => {
                    const cp = prev.slice() as [PromptDTO, PromptDTO, PromptDTO];
                    cp[idx] = next;
                    return cp;
                  });
                }}
              />
            ))}
          </div>
        </section>

        <div className="flex items-center justify-end pt-2">
          <SaveButton state={savingState} />
        </div>
      </form>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

// SaveButton : transition fluide idle → busy (spinner + label) → saved
// (checkmark vert + label) → idle. AnimatePresence avec mode="wait" pour
// que le swap d'icône / fond / texte arrive en un mouvement cohérent.
function SaveButton({ state }: { state: "idle" | "busy" | "saved" }) {
  const t = useT();
  const isSaved = state === "saved";
  const isBusy = state === "busy";
  return (
    <motion.button
      type="submit"
      disabled={isBusy}
      animate={{
        backgroundColor: isSaved ? "rgb(16 185 129)" : undefined,
      }}
      transition={{ duration: 0.25 }}
      className="relative flex h-11 min-w-[10rem] items-center justify-center gap-2 overflow-hidden rounded-xl bg-neutral-900 px-5 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="inline-flex items-center gap-2"
        >
          {isBusy && <Spinner />}
          {isSaved && <CheckIcon />}
          <span>
            {isBusy
              ? t.account.saving
              : isSaved
                ? t.account.saved
                : t.account.save}
          </span>
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

function Spinner() {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2"
        strokeOpacity="0.3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <motion.svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <motion.path
        d="M5 12.5l5 5 9-11"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      />
    </motion.svg>
  );
}

