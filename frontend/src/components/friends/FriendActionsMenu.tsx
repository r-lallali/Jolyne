"use client";

import { useEffect, useRef } from "react";
import { useT } from "@/lib/i18n";

// FriendActionsMenu : popover discret ancré sous le bouton ⋯ du header
// d'une conversation friend. Trois entrées : mute / unmute, signaler,
// retirer. Click outside / Escape ferme. La prop `muted` swap le label de
// la première entrée — la persistance est gérée par le caller.
export function FriendActionsMenu({
  muted,
  onToggleMute,
  onReport,
  onRemove,
  onClose,
}: {
  muted: boolean;
  onToggleMute: () => void;
  onReport: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      role="menu"
      className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
    >
      <MenuItem onClick={onToggleMute} icon={<MuteIcon muted={muted} />}>
        {muted ? t.chats.unmute : t.chats.mute}
      </MenuItem>
      <MenuItem onClick={onReport} icon={<FlagIcon />} variant="warning">
        {t.chats.report}
      </MenuItem>
      <div className="my-1 border-t border-neutral-100 dark:border-neutral-900" />
      <MenuItem onClick={onRemove} icon={<TrashIcon />} variant="danger">
        {t.chats.remove}
      </MenuItem>
    </div>
  );
}

function MenuItem({
  onClick,
  icon,
  children,
  variant,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  variant?: "warning" | "danger";
}) {
  const tone =
    variant === "danger"
      ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
      : variant === "warning"
        ? "text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-500/10"
        : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900";
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${tone}`}
    >
      <span className="inline-flex size-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="truncate">{children}</span>
    </button>
  );
}

function MuteIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      {muted && <path d="M3 3l18 18" />}
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden
    >
      <path d="M4 22V4" />
      <path d="M4 4h12l-2 4 2 4H4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
