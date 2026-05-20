"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useMatch } from "@/hooks/useMatch";
import { buzz } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useChatStore } from "@/stores/chatStore";

// Bloc inline qui apparaît dans la conversation après 10 min de chat
// (ancré comme un message). Le serveur a déjà filtré : ne fire que si
// les deux peers sont authentifiés (sess.UserID > 0 des deux côtés).
//
// États (depuis chatStore.friendPrompt) :
//   - shown          : 2 boutons (Accepter / ignorer le compteur)
//   - self_accepted  : message "on attend l'autre…"
//   - skipped        : message neutre "pas cette fois"
//   - made           : message "vous êtes amis" + lien vers le chat
export function FriendPromptCard() {
  const t = useT();
  const fp = useChatStore((s) => s.friendPrompt);
  const peerNick = useChatStore((s) => s.peerNick);
  const { acceptFriend } = useMatch();

  if (!fp) return null;

  const onAccept = () => {
    buzz(15);
    acceptFriend();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="mx-auto mt-6 flex w-full flex-col items-center gap-3 py-4"
    >
      <div
        aria-hidden
        className="h-px w-16 bg-emerald-500/40 dark:bg-emerald-400/40"
      />
      {fp.kind === "shown" && (
        <>
          <div className="text-center">
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
              {t.friendPrompt.title({ nick: peerNick ?? "" })}
            </p>
            <p className="mt-1 max-w-md text-xs text-neutral-500 dark:text-neutral-400">
              {t.friendPrompt.hint}
            </p>
          </div>
          <button
            type="button"
            onClick={onAccept}
            autoFocus
            className="rounded-full bg-emerald-500/15 px-4 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/25 dark:text-emerald-400"
          >
            ❤ {t.friendPrompt.accept}
          </button>
        </>
      )}
      {fp.kind === "self_accepted" && (
        <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
          {t.friendPrompt.waiting}
        </p>
      )}
      {fp.kind === "skipped" && (
        <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
          {t.friendPrompt.skipped}
        </p>
      )}
      {fp.kind === "made" && (
        <>
          <p className="text-center text-sm font-medium text-emerald-700 dark:text-emerald-400">
            ❤ {t.friendPrompt.made}
          </p>
          <Link
            href={`/chats/${fp.friendId}`}
            className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs text-neutral-700 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            {t.friendPrompt.openChat}
          </Link>
        </>
      )}
    </motion.div>
  );
}
