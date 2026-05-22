"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useMatch } from "@/hooks/useMatch";
import { buzz } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useChatStore } from "@/stores/chatStore";
import { useUserStore } from "@/stores/userStore";
import { LoginSheet } from "@/components/auth/LoginSheet";
import { useEffect, useState } from "react";
import { listFriends } from "@/lib/friends";

// Bloc inline qui apparaît dans la conversation après 10 min de chat
// (ancré comme un message). Éligible pour les utilisateurs enregistrés et anonymes.
//
// États (depuis chatStore.friendPrompt) :
//   - shown          : 2 boutons (Accepter / ignorer le compteur)
//   - self_accepted  : message "on attend l'autre…"
//   - skipped        : message neutre "pas cette fois"
//   - made           : message "vous êtes amis" (friendId > 0) OU invite d'enregistrement (friendId === -1)
export function FriendPromptCard() {
  const t = useT();
  const fp = useChatStore((s) => s.friendPrompt);
  const peerNick = useChatStore((s) => s.peerNick);
  const { acceptFriend } = useMatch();
  
  const user = useUserStore((s) => s.user);
  const [authOpen, setAuthOpen] = useState(false);
  const [resolvedId, setResolvedId] = useState<number | null>(null);
  const [loadingFriend, setLoadingFriend] = useState(false);

  useEffect(() => {
    if (user && fp?.kind === "made" && fp.friendId === -1) {
      // Nous étions anonymes et venons de nous inscrire ou nous connecter !
      // On interroge les amis avec quelques retries pour récupérer l'ID de la nouvelle amitié créée en arrière-plan.
      setLoadingFriend(true);
      let attempts = 0;
      const interval = setInterval(async () => {
        try {
          const list = await listFriends();
          if (list && list.length > 0) {
            // Trie par ordre décroissant de création
            list.sort(
              (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime()
            );
            const first = list[0];
            if (first) {
              setResolvedId(first.id);
              setLoadingFriend(false);
              clearInterval(interval);
            }
          }
        } catch (e) {
          console.error("Erreur de récupération de l'amitié résolue:", e);
        }
        attempts++;
        if (attempts >= 8) {
          setLoadingFriend(false);
          clearInterval(interval);
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [user, fp]);

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
      
      {/* 1. Écran d'invitation standard / Choix */}
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
            {t.friendPrompt.accept}
          </button>
        </>
      )}

      {/* 2. En attente de l'acceptation de l'autre */}
      {fp.kind === "self_accepted" && (
        <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
          {t.friendPrompt.waiting}
        </p>
      )}

      {/* 3. Rejet / Passé */}
      {fp.kind === "skipped" && (
        <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
          {t.friendPrompt.skipped}
        </p>
      )}

      {/* 4. Match d'amitié réussi (Cas Direct - Deux comptes enregistrés) */}
      {fp.kind === "made" && fp.friendId > 0 && (
        <>
          <p className="text-center text-sm font-medium text-emerald-700 dark:text-emerald-400">
            {t.friendPrompt.made}
          </p>
          <Link
            href={`/chats/${fp.friendId}`}
            className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs text-neutral-700 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            {t.friendPrompt.openChat}
          </Link>
        </>
      )}

      {/* 5. Match d'amitié réussi mais en attente (Au moins un anonyme) */}
      {fp.kind === "made" && fp.friendId === -1 && (
        <>
          {/* CAS A: L'utilisateur actuel n'a pas de compte (Anonyme) */}
          {!user && (
            <div className="flex w-full max-w-sm flex-col items-center rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center shadow-lg backdrop-blur-md dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <div className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <svg
                  className="size-7 animate-bounce"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                  />
                </svg>
              </div>
              <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-50">
                🎉 Match d&apos;amitié validé !
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
                Vous avez tous les deux accepté de garder contact ! Crée ton compte ou connecte-toi pour ne pas perdre cette conversation et l&apos;ajouter à tes amis.
              </p>
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="mt-5 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg"
              >
                🚀 Garder contact (C&apos;est gratuit)
              </button>
            </div>
          )}

          {/* CAS B: L'utilisateur actuel est enregistré mais le correspondant est anonyme (En attente) */}
          {user && !resolvedId && (
            <div className="flex w-full max-w-sm flex-col items-center rounded-3xl border border-neutral-200 bg-neutral-50/50 p-6 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900/50">
              {loadingFriend ? (
                <div className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <svg
                    className="size-7 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89"
                    />
                  </svg>
                </div>
              ) : (
                <div className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <svg
                    className="size-7"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              )}
              <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-50">
                {loadingFriend
                  ? "🎉 Création du lien d&apos;amitié..."
                  : "⏳ Invitation acceptée !"}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                {loadingFriend
                  ? "Ton compte a été relié avec succès. Nous préparons ta messagerie privée..."
                  : `Nous attendons que ${
                      peerNick || "ton correspondant"
                    } crée son compte ou se connecte pour vous ajouter mutuellement.`}
              </p>
            </div>
          )}

          {/* CAS C: L'amitié vient de se résoudre avec succès après inscription */}
          {resolvedId && (
            <div className="flex w-full max-w-sm flex-col items-center rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center shadow-lg backdrop-blur-md dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <div className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 animate-pulse">
                <svg
                  className="size-7"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-50">
                🎉 Vous êtes maintenant amis !
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
                Ton compte a été créé avec succès et tu es désormais connecté avec {peerNick}.
              </p>
              <Link
                href={`/chats/${resolvedId}`}
                className="mt-5 w-full rounded-2xl bg-neutral-900 py-3 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.02] active:scale-[0.98] dark:bg-neutral-50 dark:text-neutral-900"
              >
                💬 Ouvrir notre conversation
              </Link>
            </div>
          )}
        </>
      )}

      {/* Sheet d'authentification */}
      <LoginSheet open={authOpen} onClose={() => setAuthOpen(false)} />
    </motion.div>
  );
}
