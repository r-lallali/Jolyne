"use client";

interface Props {
  peerNick: string | null;
  status: "matched" | "queued" | "connecting";
  onNext: () => void;
  onStop: () => void;
}

export function ChatHeader({ peerNick, status, onNext, onStop }: Props) {
  const label =
    status === "matched"
      ? peerNick
      : status === "queued"
        ? "en recherche…"
        : "connexion…";

  return (
    <header className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-neutral-100">
          {label}
        </p>
        <p className="text-xs text-neutral-500">
          {status === "matched" ? "en ligne" : "patiente"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onNext}
          disabled={status !== "matched"}
          className="rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-900 disabled:opacity-30"
        >
          Suivant
        </button>
        <button
          type="button"
          onClick={onStop}
          className="rounded-md px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-300"
        >
          Quitter
        </button>
      </div>
    </header>
  );
}
