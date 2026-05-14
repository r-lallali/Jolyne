"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChatView } from "@/components/chat/ChatView";
import { SearchingView } from "@/components/chat/SearchingView";
import { SetupView } from "@/components/setup/SetupView";
import { useMatch } from "@/hooks/useMatch";
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
  const fatal = code === "quota_exceeded" || code === "invalid_pseudo";
  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-6 px-6 text-center sm:h-[92vh]">
      <p className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
        {labelForCode(code)}
      </p>
      <p className="max-w-sm text-balance text-sm text-neutral-500 dark:text-neutral-400">
        {hintForCode(code, message)}
      </p>
      <div className="flex gap-3">
        {!fatal && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-100 transition-opacity hover:opacity-90 dark:bg-neutral-100 dark:text-neutral-900"
          >
            Réessayer
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className="rounded-md px-4 py-2 text-sm text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          Retour
        </button>
      </div>
    </div>
  );
}

function labelForCode(code: string | null): string {
  switch (code) {
    case "queue_timeout":
      return "Personne pour le moment.";
    case "quota_exceeded":
      return "Tu as utilisé tes 10 « suivant » du jour.";
    case "invalid_pseudo":
      return "Ce pseudo n'est pas accepté.";
    case "invalid_param":
      return "Configuration invalide.";
    case "message_blocked":
    case "message_too_long":
      return "Message refusé.";
    default:
      return "Erreur inattendue.";
  }
}

function hintForCode(code: string | null, message: string | null): string {
  switch (code) {
    case "queue_timeout":
      return "Peu de monde est en ligne sur cette paire de langues. Réessaie dans quelques instants.";
    case "quota_exceeded":
      return "Reviens demain. Premium retire cette limite (à venir).";
    case "invalid_pseudo":
      return "Choisis un pseudo entre 3 et 20 caractères, sans terme grossier.";
    case "invalid_param":
      return (
        message ??
        "Vérifie ta paire de langues — toutes les combinaisons ne sont pas encore disponibles."
      );
    default:
      return message ?? "Réessaie ou recommence depuis le début.";
  }
}
