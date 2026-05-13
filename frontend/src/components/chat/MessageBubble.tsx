"use client";

import { cn } from "@/lib/cn";

interface Props {
  from: "me" | "peer";
  body: string;
}

export function MessageBubble({ from, body }: Props) {
  const mine = from === "me";
  return (
    <div
      className={cn(
        "flex w-full",
        mine ? "justify-end" : "justify-start",
      )}
    >
      <p
        className={cn(
          "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
          mine
            ? "rounded-br-sm bg-neutral-100 text-neutral-950"
            : "rounded-bl-sm bg-neutral-800 text-neutral-100",
        )}
      >
        {body}
      </p>
    </div>
  );
}
