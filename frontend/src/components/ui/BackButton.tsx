"use client";

import Link from "next/link";

// BackButton : pastille circulaire avec flèche gauche. Visuel uniforme
// sur /account, /chats et l'en-tête d'une conversation friend.
//
// Deux modes :
//   - `href` : rendu comme <Link> Next (navigation client).
//   - `onClick` : rendu comme <button> (back inline, ex. FriendsMode).

interface Props {
  href?: string;
  onClick?: () => void;
  label: string;
}

export function BackButton({ href, onClick, label }: Props) {
  const cls =
    "inline-flex size-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100";
  if (href) {
    return (
      <Link href={href} aria-label={label} title={label} className={cls}>
        <ArrowLeft />
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cls}
    >
      <ArrowLeft />
    </button>
  );
}

function ArrowLeft() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}
