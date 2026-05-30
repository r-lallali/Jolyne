"use client";

import { motion } from "framer-motion";

interface Props {
  body: string;
}

export function SystemMessage({ body }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="flex w-full justify-center py-2"
    >
      <p className="px-3 text-center text-[11px] italic text-neutral-400 dark:text-neutral-500">
        {body}
      </p>
    </motion.div>
  );
}
