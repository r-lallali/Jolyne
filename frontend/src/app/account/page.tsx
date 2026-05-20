"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AccountDTO,
  PromptDTO,
  cloudinaryUrl,
  deletePhoto,
  fetchAccount,
  fetchCloudName,
  setPhoto,
  signPhotoUpload,
  updateAccount,
  uploadToCloudinary,
} from "@/lib/account";
import { useT } from "@/lib/i18n";
import { PROMPT_KEYS, PromptKey, isPromptKey } from "@/lib/prompts";
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
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {t.auth.loginCta}
        </p>
      </main>
    );
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
      <Link
        href="/"
        className="text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        ← {t.auth.backToApp}
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
        {t.account.title}
      </h1>

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

        <div className="flex items-center justify-end gap-3 pt-2">
          {savingState === "saved" && (
            <span className="text-xs text-emerald-700 dark:text-emerald-400">
              {t.account.saved}
            </span>
          )}
          <button
            type="submit"
            disabled={savingState === "busy"}
            className="rounded-xl bg-neutral-900 px-5 py-3 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:opacity-30 dark:bg-neutral-50 dark:text-neutral-900"
          >
            {savingState === "busy" ? t.account.saving : t.account.save}
          </button>
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

function PhotoSlot({
  position,
  publicId,
  cloudName,
  onUploaded,
  onDeleted,
}: {
  position: number;
  publicId?: string;
  cloudName: string;
  onUploaded: (publicId: string) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "uploading" | "error">("idle");

  const pick = () => inputRef.current?.click();

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setState("uploading");
    try {
      const sig = await signPhotoUpload();
      const pid = await uploadToCloudinary(file, sig);
      await setPhoto(position, pid);
      onUploaded(pid);
      setState("idle");
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    try {
      await deletePhoto(position);
      onDeleted();
    } catch {
      // silent
    }
  };

  return (
    <div className="relative aspect-square overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900">
      {publicId && cloudName ? (
        <img
          src={cloudinaryUrl(cloudName, publicId, { w: 480, h: 480 })}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <button
          type="button"
          onClick={pick}
          className="flex h-full w-full items-center justify-center text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          {state === "uploading"
            ? t.account.uploading
            : state === "error"
              ? t.account.uploadError
              : `+ ${t.account.addPhoto}`}
        </button>
      )}
      {position === 1 && publicId && (
        <span className="absolute left-2 top-2 rounded-full bg-neutral-900/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-neutral-50">
          {t.account.mainPhoto}
        </span>
      )}
      {publicId && (
        <div className="absolute bottom-2 right-2 flex gap-1">
          <button
            type="button"
            onClick={pick}
            className="rounded-full bg-neutral-900/80 px-2 py-1 text-[11px] font-medium text-neutral-50 hover:bg-neutral-900"
          >
            ↻
          </button>
          <button
            type="button"
            onClick={remove}
            className="rounded-full bg-red-600/90 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700"
          >
            ✕
          </button>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={onPick}
        className="hidden"
      />
    </div>
  );
}

function PromptSlot({
  slot,
  taken,
  onChange,
}: {
  slot: PromptDTO;
  taken: string[];
  onChange: (next: PromptDTO) => void;
}) {
  const t = useT();
  const promptKey = isPromptKey(slot.prompt) ? (slot.prompt as PromptKey) : "";
  return (
    <div className="rounded-2xl bg-neutral-100 p-3 dark:bg-neutral-900">
      <div className="flex items-center gap-2">
        <select
          value={promptKey}
          onChange={(e) => onChange({ prompt: e.target.value, answer: slot.answer })}
          className="flex-1 rounded-lg bg-white px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:ring-neutral-700"
        >
          <option value="">{t.account.pickPrompt}</option>
          {PROMPT_KEYS.map((k) => (
            <option key={k} value={k} disabled={taken.includes(k)}>
              {t.prompts[k]}
            </option>
          ))}
        </select>
        {promptKey && (
          <button
            type="button"
            onClick={() => onChange({ prompt: "", answer: "" })}
            className="rounded-lg px-2 py-2 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            {t.account.clearPrompt}
          </button>
        )}
      </div>
      {promptKey && (
        <textarea
          value={slot.answer}
          onChange={(e) => onChange({ prompt: promptKey, answer: e.target.value })}
          placeholder={t.account.answerPlaceholder}
          maxLength={200}
          rows={2}
          className="mt-2 w-full resize-none rounded-lg bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:ring-neutral-700"
        />
      )}
    </div>
  );
}

function replacePhoto(
  photos: AccountDTO["photos"],
  position: number,
  publicId: string,
): AccountDTO["photos"] {
  const idx = photos.findIndex((p) => p.position === position);
  if (idx < 0) {
    return [...photos, { position, public_id: publicId }].sort(
      (a, b) => a.position - b.position,
    );
  }
  const next = photos.slice();
  next[idx] = { position, public_id: publicId };
  return next;
}
