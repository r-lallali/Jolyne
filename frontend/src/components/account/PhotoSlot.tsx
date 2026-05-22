"use client";

import { useRef, useState } from "react";
import {
  AccountDTO,
  cloudinaryUrl,
  deletePhoto,
  setPhoto,
  signPhotoUpload,
  uploadToCloudinary,
} from "@/lib/account";
import { useT } from "@/lib/i18n";

// PhotoSlot : 1 case dans la grille des 6 photos /account. Gère son
// propre cycle d'upload (sign → POST Cloudinary direct → enregistrement
// en DB via setPhoto). Position 1 = avatar visible en chat.
export function PhotoSlot({
  position,
  publicId,
  cloudName,
  onUploaded,
  onDeleted,
  isDragging = false,
  isOver = false,
}: {
  position: number;
  publicId?: string;
  cloudName: string;
  onUploaded: (publicId: string) => void;
  onDeleted: () => void;
  isDragging?: boolean;
  isOver?: boolean;
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
    <div
      className={`relative aspect-square overflow-hidden rounded-2xl transition-all duration-150 ${
        isDragging
          ? "scale-95 opacity-50 ring-2 ring-neutral-400 dark:ring-neutral-600"
          : isOver
            ? "ring-2 ring-blue-500 scale-105 bg-blue-50 dark:bg-blue-950"
            : "bg-neutral-100 dark:bg-neutral-900"
      }`}
    >
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

// replacePhoto : helper pur — insère ou met à jour la photo à la position
// donnée dans la liste, en gardant l'ordre par position.
export function replacePhoto(
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
