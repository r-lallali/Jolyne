"use client";

import { ChatView } from "@/components/chat/ChatView";
import { SetupView } from "@/components/setup/SetupView";
import { useMatch } from "@/hooks/useMatch";
import { useChatStore } from "@/stores/chatStore";

// Conversation est la racine logique de l'app : route entre les vues selon
// le status du chatStore. Une seule instance par session.
export function Conversation() {
  const status = useChatStore((s) => s.status);
  const errorCode = useChatStore((s) => s.errorCode);
  const errorMessage = useChatStore((s) => s.errorMessage);
  const reset = useChatStore((s) => s.reset);
  const { start } = useMatch();

  if (status === "idle") return <SetupView />;
  if (status === "error") {
    return (
      <ErrorView
        code={errorCode}
        message={errorMessage}
        onRetry={start}
        onBack={reset}
      />
    );
  }
  return <ChatView />;
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
    <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <p className="text-lg text-neutral-200">{labelForCode(code)}</p>
      <p className="max-w-xs text-sm text-neutral-500">
        {hintForCode(code, message)}
      </p>
      <div className="flex gap-3">
        {!fatal && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950"
          >
            Réessayer
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-neutral-800 px-4 py-2 text-sm text-neutral-300"
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
      return "Personne n'a été trouvé pour le moment.";
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
        "Vérifie ta paire de langues. Toutes les combinaisons ne sont pas encore disponibles."
      );
    default:
      return message ?? "Réessaie ou recommence depuis le début.";
  }
}
