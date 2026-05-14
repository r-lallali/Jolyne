"use client";

interface Props {
  peerNick: string | null;
  status: "matched" | "queued" | "connecting";
  onNext: () => void;
  onStop: () => void;
}

export function ChatHeader({ peerNick, status, onNext, onStop }: Props) {
  const matched = status === "matched";
  const label =
    matched && peerNick
      ? peerNick
      : status === "queued"
        ? "Recherche d'un partenaire…"
        : "Connexion…";
  const sub = matched
    ? "en ligne"
    : status === "queued"
      ? "Patiente quelques secondes."
      : "On se connecte au serveur.";

  return (
    <header className="flex items-center justify-between border-b border-neutral-900 bg-neutral-950/60 px-4 py-3 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`inline-block size-2 rounded-full ${matched ? "bg-emerald-400" : "bg-neutral-600"}`}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-neutral-100">
            {label}
          </p>
          <p className="text-xs text-neutral-500">{sub}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onNext}
          disabled={!matched}
          className="rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-30"
        >
          Suivant
        </button>
        <button
          type="button"
          onClick={onStop}
          className="rounded-md px-3 py-1.5 text-xs text-neutral-500 transition-colors hover:text-neutral-300"
        >
          Quitter
        </button>
      </div>
    </header>
  );
}
