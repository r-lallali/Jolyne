"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { ChatView } from "@/components/chat/ChatView";
import { FarewellView } from "@/components/chat/FarewellView";
import { SearchingView } from "@/components/chat/SearchingView";
import { FriendsMode } from "@/components/friends/FriendsMode";
import { ModeTabs, type Mode } from "@/components/ModeTabs";
import { SetupView } from "@/components/setup/SetupView";
import { useMatch } from "@/hooks/useMatch";
import { useT, type Messages } from "@/lib/i18n";
import { useChatStore } from "@/stores/chatStore";
import { usePaywallStore } from "@/stores/paywallStore";
import { useUserStore } from "@/stores/userStore";

// Mode actif de la home conservé en mémoire (module-level) le temps de la
// session JS : survit aux navigations SPA — typiquement l'aller-retour vers
// /account remonte Conversation, qui repart alors sur le dernier mode choisi
// (chat anonyme ou conversations amis). Un vrai rechargement de page
// ré-évalue le module → retour au défaut "anon", comportement attendu.
let lastHomeMode: Mode = "anon";

export function Conversation() {
  const status = useChatStore((s) => s.status);
  const errorCode = useChatStore((s) => s.errorCode);
  const errorMessage = useChatStore((s) => s.errorMessage);
  const reset = useChatStore((s) => s.reset);
  const { start } = useMatch();
  const authedUser = useUserStore((s) => s.user);
  const hydrated = useUserStore((s) => s.hydrated);
  // Mode = onglet actif (anon = chat anonyme, friends = conversations
  // privées). Initialisé sur le dernier mode mémorisé (cf. lastHomeMode) :
  // un refresh ramène sur "anon", un aller-retour /account conserve le mode.
  const [mode, setMode] = useState<Mode>(lastHomeMode);
  // Direction du slide entre les deux modes : 1 = anon → friends (le
  // nouveau panneau entre depuis la droite), -1 = friends → anon (depuis
  // la gauche). Mémorisé pour qu'AnimatePresence puisse en faire usage
  // dans `custom`.
  const [slideDir, setSlideDir] = useState(1);
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setSlideDir(next === "friends" ? 1 : -1);
    setMode(next);
    lastHomeMode = next;
  };

  // Référence stable pour switchMode afin d'éviter la stale closure dans l'effet tactile
  const switchModeRef = useRef(switchMode);
  switchModeRef.current = switchMode;

  // Sur tout retour vers "idle" (quit, error→back, bfcache), on remet
  // l'URL à plat. Sinon un hash #config résiduel (laissé par la nav
  // setup avant la conv) refait atterrir SetupView sur l'étape config
  // au lieu de pseudo.
  const prevStatus = useRef(status);
  useEffect(() => {
    if (
      status === "idle" &&
      prevStatus.current !== "idle" &&
      typeof window !== "undefined" &&
      window.location.hash
    ) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    prevStatus.current = status;
  }, [status]);

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
  } else if (status === "matched" || status === "post_chat") {
    // post_chat reste dans ChatView : la conversation est visible scrollable,
    // un PostChatCard apparaît au bas du fil et l'input est masqué.
    view = <ChatView />;
    key = "chat";
  } else if (status === "ended") {
    view = <FarewellView />;
    key = "farewell";
  } else {
    view = <SearchingView />;
    key = "searching";
  }

  // Pas de initial={false} sur l'AnimatePresence : ça propage via
  // MotionContext et casse les animations d'entrée internes (ex: slide
  // pseudo→config) au premier mount. On accepte un léger fade-in sur la
  // 1re vue.
  const showTabs = hydrated && !!authedUser;
  // Les deux barres de switch anon/amis sont masquées sur l'écran de choix
  // des langues (setup = mode anon + status idle) : il reste épuré. Le swipe
  // continue d'y fonctionner (showTabs inchangé) pour rejoindre les amis.
  const showModeTabs = showTabs && !(mode === "anon" && status === "idle");
  // En mode "friends", on remplace tout le contenu chat anonyme par la vue
  // amis. Les barres restent visibles au-dessus pour permettre de revenir.

  // Swipe horizontal pour switcher entre anon ↔ friends. Listeners
  // attachés sur document (touchstart / touchend) via useEffect pour
  // contourner les problèmes de propagation à travers les motion.div
  // de framer-motion. Même seuils que FriendConversation.
  //
  // Annulé si :
  //   - geste clairement vertical (= scroll, protège le scroll)
  //   - démarre sur un input / textarea / [contenteditable]
  //   - démarre dans une zone marquée data-no-swipe
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const showTabsRef = useRef(showTabs);
  showTabsRef.current = showTabs;

  useEffect(() => {
    let start: { x: number; y: number } | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (!showTabsRef.current) return;
      const t = e.touches[0];
      if (!t) return;
      const target = e.target as HTMLElement;
      if (
        target.closest("input,textarea,[contenteditable=\"true\"]") ||
        target.closest("[data-no-swipe]")
      ) {
        start = null;
        return;
      }
      start = { x: t.clientX, y: t.clientY };
    };

    const onTouchEnd = (e: TouchEvent) => {
      const s = start;
      start = null;
      if (!s) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      // Geste horizontal franc uniquement — protège le scroll vertical.
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const m = modeRef.current;
      if (dx < 0 && m === "anon") switchModeRef.current("friends");
      if (dx > 0 && m === "friends") switchModeRef.current("anon");
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  // switchMode dépend de mode via closure mais modeRef.current le
  // fournit sans re-register. Les refs showTabsRef/modeRef sont stables.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Desktop : pointer events souris (drag). Même logique, filtrés sur
  // mouse only car le tactile est géré par les listeners document.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!showTabs || !authedUser) return;
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest("input,textarea,[contenteditable=\"true\"]") ||
      target.closest("[data-no-swipe]")
    ) return;
    swipeStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const minDist = Math.min(60, vw * 0.18);
    if (Math.abs(dx) < minDist || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    if (dx < 0 && mode === "anon") switchMode("friends");
    if (dx > 0 && mode === "friends") switchMode("anon");
  };

  // Variants du slide horizontal entre les deux modes. Le `custom` passé
  // à AnimatePresence + motion permet à `enter`/`exit` de lire la
  // direction au moment où la transition démarre. Spring pour un feel iOS.
  const slideVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? 80 : -80, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -80 : 80, opacity: 0 }),
  };

  return (
    <>
      {showModeTabs && (
        <ModeTabs mode={mode} onChange={switchMode} />
      )}
      <div
        // `self-start` casse le centrage vertical du `<main>` parent
        // uniquement pour le mode amis : la liste doit remonter en haut
        // de viewport, alors que le chat anonyme reste centré. Doit être
        // sur ce wrapper (et pas sur la motion.div interne) car c'est lui
        // qui est l'enfant direct du flex parent.
        className={
          "flex w-full justify-center " +
          (mode === "friends" ? "self-start" : "")
        }
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <AnimatePresence mode="popLayout" initial={false} custom={slideDir}>
          <motion.div
            key={mode}
            custom={slideDir}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", stiffness: 320, damping: 30, opacity: { duration: 0.18 } }}
            className="flex w-full justify-center"
          >
            {mode === "friends" && authedUser ? (
              <FriendsMode />
            ) : (
              <AnimatePresence mode="wait">
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
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
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
  const showPaywall = usePaywallStore((s) => s.show);
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
        {code === "quota_exceeded" && (
          <button
            type="button"
            onClick={() => showPaywall("swipe")}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-100 transition-opacity hover:opacity-90 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {t.premium.upgradeCta}
          </button>
        )}
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
