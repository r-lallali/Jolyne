"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

interface Props {
  from: "me" | "peer";
  body: string;
}

export function MessageBubble({ from, body }: Props) {
  const mine = from === "me";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
    >
      <p
        className={cn(
          "max-w-[78%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm shadow-sm",
          mine
            ? "rounded-br-sm bg-neutral-100 text-neutral-950"
            : "rounded-bl-sm bg-neutral-800/80 text-neutral-100",
        )}
      >
        {body}
      </p>
    </motion.div>
  );
}
