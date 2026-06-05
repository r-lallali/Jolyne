import { cn } from "@/lib/cn";

interface Props {
  className?: string;
}

export function VerifiedBadge({ className }: Props) {
  return (
    <svg
      className={cn("size-4 text-blue-500 dark:text-blue-400 fill-current inline-block select-none", className)}
      viewBox="0 0 24 24"
      aria-label="Profil Vérifié"
    >
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  );
}
