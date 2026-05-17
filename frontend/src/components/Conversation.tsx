"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChatView } from "@/components/chat/ChatView";
import { FarewellView } from "@/components/chat/FarewellView";
import { PostChatView } from "@/components/chat/PostChatView";
import { SearchingView } from "@/components/chat/SearchingView";
import { SetupView } from "@/components/setup/SetupView";
import { useMatch } from "@/hooks/useMatch";
import { useT, type Messages } from "@/lib/i18n";
import { useChatStore } from "@/stores/chatStore";

export function Conversation() {
  const status = useChatStore((s) => s.status);
  const errorCode = useChatStore((s) => s.errorCode);
  const errorMessage = useChatStore((s) => s.errorMessage);
  const reset = useChatStore((s) => s.reset);
  const { start } = useMatch();

  let view: React.ReactNode;
  let key: string;
  if (status === "idle") {
    view = <SetupView />;
    key = "setup";
  } else if (status === "error") {
    view = (
      <ErrorView
        code={errorCode}
        message={errorMessage}
        onRetry={start}
        onBack={reset}
      />
    );
    key = "error";
  } else if (status === "matched") {
    view = <ChatView />;
    key = "chat";
  } else if (status === "post_chat") {
    view = <PostChatView />;
    key = "post_chat";
  } else if (status === "ended") {
    view = <FarewellView />;
    key = "farewell";
  } else {
    view = <SearchingView />;
    key = "searching";
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={key}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="flex w-full justify-center"
      >
        {view}
      </motion.div>
    </AnimatePresence>
  );
}

interface ErrorProps {
  code: string | null;
  message: string | null;
  onRetry: () => void;
  onBack: () => void;
}

function ErrorView({ code, message, onRetry, onBack }: ErrorProps) {
  const t = useT();
  const fatal =
    code === "quota_exceeded" ||
    code === "invalid_pseudo" ||
    code === "banned";
  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-6 px-6 text-center sm:h-[92vh]">
      <p className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
        {labelForCode(code, t)}
      </p>
      <p className="max-w-sm text-balance text-sm text-neutral-500 dark:text-neutral-400">
        {hintForCode(code, message, t)}
      </p>
      <div className="flex gap-3">
        {!fatal && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-100 transition-opacity hover:opacity-90 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {t.errors.retry}
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className="rounded-md px-4 py-2 text-sm text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          {t.common.back}
        </button>
      </div>
    </div>
  );
}

function labelForCode(code: string | null, t: Messages): string {
  switch (code) {
    case "queue_timeout":
      return t.errors.queueTimeoutTitle;
    case "quota_exceeded":
      return t.errors.quotaExceededTitle;
    case "invalid_pseudo":
      return t.errors.invalidPseudoTitle;
    case "invalid_param":
      return t.errors.invalidParamTitle;
    case "banned":
      return t.errors.bannedTitle;
    case "message_blocked":
    case "message_too_long":
      return t.errors.messageBlockedTitle;
    default:
      return t.errors.genericTitle;
  }
}

function hintForCode(
  code: string | null,
  message: string | null,
  t: Messages,
): string {
  switch (code) {
    case "queue_timeout":
      return t.errors.queueTimeoutHint;
    case "quota_exceeded":
      return t.errors.quotaExceededHint;
    case "invalid_pseudo":
      return t.errors.invalidPseudoHint;
    case "invalid_param":
      return message ?? t.errors.invalidParamHint;
    case "banned":
      return message ?? t.errors.bannedHint;
    default:
      return message ?? t.errors.genericHint;
  }
}
