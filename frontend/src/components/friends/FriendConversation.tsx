"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageInput } from "@/components/chat/MessageInput";
import { ReportModal } from "@/components/chat/ReportModal";
import { SystemMessage } from "@/components/chat/SystemMessage";
import {
  TranslationPopover,
  type TranslationRequest,
} from "@/components/chat/TranslationPopover";
import { FriendActionsMenu } from "@/components/friends/FriendActionsMenu";
import { StreakBadge } from "@/components/friends/StreakBadge";
import { StreakLostBanner } from "@/components/friends/StreakLostBanner";
import { StreakRestoreModal } from "@/components/friends/StreakRestoreModal";
import { BackButton } from "@/components/ui/BackButton";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { cloudinaryUrl, fetchCloudName } from "@/lib/account";
import {
  FriendMessage,
  FriendProfile,
  getFriendProfile,
  removeFriend,
  reportFriend,
} from "@/lib/friends";
import { openFriendWS, FriendWSHandle } from "@/lib/friend_ws";
import { useT } from "@/lib/i18n";
import { useSessionStore } from "@/stores/sessionStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUserStore } from "@/stores/userStore";

// Clé localStorage pour le mute par ami. Non synchronisé serveur — c'est
// un settings strictement UI tant qu'on n'a pas de notifs push réelles.
const muteKey = (id: number) => `jolyne:muted_friend_${id}`;

// formatSystemBody : convertit un message système (kind + payload JSON)
// en texte localisé. Fallback sur `body` (FR brut côté serveur) si le
// kind est inconnu ou le payload illisible — garantit qu'on ne montre
// pas une chaîne vide.
function formatSystemBody(
  m: FriendMessage,
  t: ReturnType<typeof useT>,
): string {
  if (m.kind === "system_streak_lost") {
    const days = parseSystemPayload(m.payload).days;
    if (typeof days === "number" && days > 0) {
      return t.chat.systemStreakLost({ days });
    }
  }
  if (m.kind === "system_streak_restored") {
    const days = parseSystemPayload(m.payload).days;
    if (typeof days === "number" && days > 0) {
      return t.chat.systemStreakRestored({ days });
    }
  }
  return m.body || "";
}

function parseSystemPayload(raw?: string): { days?: number } {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object") return v as { days?: number };
  } catch {
    // Payload corrompu — on retombe sur le body brut.
  }
  return {};
}

// FriendConversation : UI complète d'un chat persisté entre amis.
// Réutilisable : embarquée inline dans FriendsMode (toggle home) ou dans
// la page dédiée /chats/[id]. Le callback `onBack` permet à l'embeddeur
// de retourner à sa liste (vs navigation full-page sur la route dédiée).
export function FriendConversation({
  friendId,
  onBack,
  onLeft,
  onOpenProfile,
}: {
  friendId: number;
  onBack: () => void;
  // Appelé quand la convo se ferme définitivement (peer retiré + suppression
  // confirmée par l'utilisateur). Permet à FriendsMode de retomber sur la
  // liste sans navigation full-page.
  onLeft?: () => void;
  // Si fourni, l'avatar du header devient cliquable et appelle ce callback.
  onOpenProfile?: () => void;
}) {
  const t = useT();
  const user = useUserStore((s) => s.user);
  const hydrated = useUserStore((s) => s.hydrated);
  const setActiveFriendId = useNotificationStore((s) => s.setActiveFriendId);
  const setLiveStreak = useNotificationStore((s) => s.setLiveStreak);
  const liveStreak = useNotificationStore(
    (s) => s.streakByFriend[friendId],
  );
  // Déclare cette conv comme active dans le store global → l'InboxProvider
  // sait qu'il ne doit pas notifier de cet ami pendant que l'utilisateur
  // est en train de lui parler. Cleanup en unmount.
  useEffect(() => {
    setActiveFriendId(friendId);
    return () => setActiveFriendId(null);
  }, [friendId, setActiveFriendId]);
  const [profile, setProfile] = useState<FriendProfile | null>(null);
  const [cloud, setCloud] = useState("");
  const [msgs, setMsgs] = useState<FriendMessage[]>([]);
  const [peerRemovedMe, setPeerRemovedMe] = useState(false);
  // Timestamp (ISO) auquel le peer a marqué la conv comme lue. On affiche
  // "Vu" sous mes propres messages dont sent_at <= peerReadAt.
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [muted, setMuted] = useState(false);
  const [trans, setTrans] = useState<TranslationRequest | null>(null);
  // Mobile : swipe gauche sur la liste → révèle les heures à côté des
  // bulles. Swipe droit → les recache. Sur desktop les heures sont
  // toujours visibles (via le breakpoint sm: du time-pill).
  const [timesRevealed, setTimesRevealed] = useState(false);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  // Sélection multi pour suppression groupée.
  const [selectedIDs, setSelectedIDs] = useState<Set<number>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const selectionMode = selectedIDs.size > 0;
  const toggleSelected = (id: number) => {
    setSelectedIDs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIDs(new Set());
  const speaks = useSessionStore((s) => s.speaks);
  const wants = useSessionStore((s) => s.wants);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasLoadedHistory = useRef(false);
  const wsRef = useRef<FriendWSHandle | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);

  const receivePeerTyping = () => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }
    setPeerTyping(true);
    typingTimerRef.current = setTimeout(() => {
      setPeerTyping(false);
      typingTimerRef.current = null;
    }, 3500);
  };

  // Tap-to-translate sur les messages du peer : on garde le même contrat
  // que le chat anonyme (MessageBubble appelle onSelect avec le mot + son
  // rect viewport). Langues : on reprend la paire setup speaks/wants —
  // fallback fr/en si l'user arrive direct sur /chats sans avoir matché.
  const handleSelect = (text: string, rect: DOMRect) => {
    setTrans({
      text,
      x: rect.left + rect.width / 2,
      y: rect.bottom,
      source: wants ?? "en",
      target: speaks ?? "fr",
    });
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    setMuted(localStorage.getItem(muteKey(friendId)) === "1");
  }, [friendId]);

  const toggleMute = () => {
    setMuted((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.setItem(muteKey(friendId), "1");
        else localStorage.removeItem(muteKey(friendId));
      } catch {
        // localStorage indisponible (incognito / quota) — état local suffit
      }
      return next;
    });
    setMenuOpen(false);
  };

  const submitReport = async (reason: string) => {
    try {
      await reportFriend(friendId, reason);
    } catch {
      // silent — la confirmation est déjà affichée par la modale
    }
  };

  useEffect(() => {
    if (!hydrated || !user || !Number.isFinite(friendId)) return;
    Promise.all([getFriendProfile(friendId), fetchCloudName().catch(() => "")])
      .then(([p, cn]) => {
        setProfile(p);
        setCloud(cn);
        // Aligne le store live sur la vérité serveur — sinon une valeur
        // stale (ex: streak éteint par inactivité) survit en mémoire et
        // l'override `liveStreak ?? profile.streak` masque la valeur fraîche.
        setLiveStreak(friendId, p.streak ?? 0, p.streak_at_risk ?? false);
      })
      .catch(() => {});
  }, [hydrated, user, friendId, setLiveStreak]);

  useEffect(() => {
    if (!hydrated || !user || !Number.isFinite(friendId)) return;
    const handle = openFriendWS(friendId, (ev) => {
      switch (ev.type) {
        case "history":
          setMsgs(ev.messages ?? []);
          if (ev.read_at) setPeerReadAt(ev.read_at);
          break;
        case "msg":
          if (ev.msg.sender_id !== user.id) {
            setPeerTyping(false);
            if (typingTimerRef.current) {
              clearTimeout(typingTimerRef.current);
              typingTimerRef.current = null;
            }
          }
          setMsgs((prev) => {
            const idx = prev.findIndex((m) => m.id === ev.msg.id);
            if (idx < 0) return [...prev, ev.msg];
            // Remplace par l'état le plus récent (édition / suppression
            // arrivent comme un même frame avec les flags renseignés).
            const next = prev.slice();
            next[idx] = ev.msg;
            return next;
          });
          break;
        case "peer_removed":
          setPeerRemovedMe(true);
          break;
        case "read":
          setPeerReadAt(ev.read_at);
          break;
        case "typing":
          receivePeerTyping();
          break;
        case "streak":
          setProfile((prev) =>
            prev
              ? { ...prev, streak: ev.streak, streak_at_risk: ev.streak_at_risk }
              : prev,
          );
          setLiveStreak(friendId, ev.streak, ev.streak_at_risk);
          break;
        case "error":
          break;
      }
    });
    wsRef.current = handle;
    return () => {
      handle.close();
      wsRef.current = null;
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
  }, [hydrated, user, friendId]);

  useEffect(() => {
    if (msgs.length === 0) return;

    const el = scrollRef.current;
    if (!el) return;

    if (!hasLoadedHistory.current) {
      // Premier chargement : scroll instantané à plat pour éviter l'effet d'animation au montage
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      hasLoadedHistory.current = true;

      // Filet de sécurité pour mobile (attente de la fin de la passe de layout du navigateur)
      const t1 = setTimeout(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      }, 50);
      const t2 = setTimeout(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      }, 150);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    } else {
      // Nouveaux messages ou indicateur "typing" : scroll fluide et agréable
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });

      // Filet de sécurité pour garantir la fin du scroll fluide après layout
      const t1 = setTimeout(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }, 50);
      const t2 = setTimeout(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }, 150);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [msgs.length, peerTyping]);

  const remove = async () => {
    setConfirmRemove(false);
    setMenuOpen(false);
    try {
      await removeFriend(friendId);
      onLeft?.();
      onBack();
    } catch {
      // silent
    }
  };

  if (!hydrated) return null;
  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-6 pb-16 pt-[calc(env(safe-area-inset-top)+3.5rem)] sm:pt-16">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {t.auth.loginCta}
        </p>
      </main>
    );
  }

  const mainPhoto =
    profile?.photos.find((p) => p.position === 1)?.public_id ??
    profile?.photos[0]?.public_id;
  const initial = (profile?.display_name ?? "").slice(0, 1).toUpperCase();

  return (
    <div className="flex h-full w-full flex-col pt-[calc(env(safe-area-inset-top)+2.5rem)] sm:mx-auto sm:max-w-2xl sm:pt-0">
      <header className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800 sm:px-4 sm:py-3">
        <BackButton onClick={onBack} label={t.chats.back} />
        <button
          type="button"
          onClick={onOpenProfile}
          disabled={!onOpenProfile}
          aria-label={profile?.display_name || ""}
          className="inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-200 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
        >
          {mainPhoto && cloud ? (
            <img
              src={cloudinaryUrl(cloud, mainPhoto, { w: 96, h: 96 })}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            initial || null
          )}
        </button>
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">
            {profile?.display_name || "—"}
          </p>
          {profile?.peer_verified && (
            <span className="shrink-0 text-emerald-500 dark:text-emerald-400" title="Profil Vérifié">
              <VerifiedBadge className="size-4" />
            </span>
          )}
          {profile && (
            <StreakBadge
              streak={liveStreak?.streak ?? profile.streak ?? 0}
              atRisk={liveStreak?.at_risk ?? profile.streak_at_risk ?? false}
              size="md"
            />
          )}
          {muted && (
            <span
              className="shrink-0 text-neutral-400 dark:text-neutral-500"
              title={t.chats.unmute}
              aria-label={t.chats.unmute}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-4"
                aria-hidden
              >
                <path d="M2 2l20 20" />
                <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
                <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
                <path d="M18 8a6 6 0 0 0-9.33-5" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </span>
          )}
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={t.chats.menuLabel}
            aria-label={t.chats.menuLabel}
            className="inline-flex size-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:scale-95 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4"
              aria-hidden
            >
              <circle cx="5" cy="12" r="1" />
              <circle cx="12" cy="12" r="1" />
              <circle cx="19" cy="12" r="1" />
            </svg>
          </button>
          {menuOpen && (
            <FriendActionsMenu
              muted={muted}
              onToggleMute={toggleMute}
              onReport={() => {
                setMenuOpen(false);
                setReportOpen(true);
              }}
              onRemove={() => {
                setMenuOpen(false);
                setConfirmRemove(true);
              }}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        data-times-revealed={timesRevealed ? "on" : "off"}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (!t) return;
          swipeStart.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const start = swipeStart.current;
          swipeStart.current = null;
          if (!start) return;
          const end = e.changedTouches[0];
          if (!end) return;
          const dx = end.clientX - start.x;
          const dy = end.clientY - start.y;
          // Geste horizontal franc uniquement — protège le scroll vertical.
          if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          setTimesRevealed(dx < 0);
        }}
        className="group/list scrollbar-discreet flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto w-full max-w-2xl space-y-2 px-4 py-4 sm:px-6">
          {msgs.map((m) => {
            if (m.kind && m.kind !== "user") {
              return (
                <SystemMessage
                  key={m.id}
                  body={formatSystemBody(m, t)}
                />
              );
            }
            const mine = user ? m.sender_id === user.id : false;
            return (
              <MessageBubble
                key={m.id}
                from={mine ? "me" : "peer"}
                body={m.body}
                at={new Date(m.sent_at).getTime() || Date.now()}
                editedAt={m.edited_at ? new Date(m.edited_at).getTime() : undefined}
                deletedAt={m.deleted_at ? new Date(m.deleted_at).getTime() : undefined}
                peerNick={profile?.display_name ?? null}
                onSelect={handleSelect}
                onEditMessage={
                  mine ? (next) => wsRef.current?.edit(m.id, next) : undefined
                }
                onDeleteMessage={
                  mine ? () => wsRef.current?.delete(m.id) : undefined
                }
                selectionMode={selectionMode}
                selected={selectedIDs.has(m.id)}
                onEnterSelection={
                  mine && !m.deleted_at
                    ? () => setSelectedIDs(new Set([m.id]))
                    : undefined
                }
                onToggleSelected={
                  mine && !m.deleted_at ? () => toggleSelected(m.id) : undefined
                }
              />
            );
          })}

          <AnimatePresence>
            {peerTyping && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.18 }}
                className="flex w-full justify-start mt-1"
              >
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-neutral-200 px-3.5 py-2.5 dark:bg-neutral-800">
                  <span className="sr-only">
                    {profile?.display_name ?? "L'autre personne"} est en train d&apos;écrire...
                  </span>
                  <span className="inline-flex items-center gap-1">
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        className="size-1.5 rounded-full bg-neutral-500 dark:bg-neutral-400"
                        animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                        transition={{
                          duration: 1.1,
                          repeat: Infinity,
                          delay: i * 0.15,
                          ease: "easeInOut",
                        }}
                      />
                    ))}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <SeenIndicator
            msgs={msgs}
            meId={user?.id ?? 0}
            peerReadAt={peerReadAt}
          />
          {profile &&
            (profile.lost_streak ?? 0) >= 2 &&
            (profile.streak ?? 0) === 0 && (
              <StreakLostBanner
                lostStreak={profile.lost_streak ?? 0}
                peerName={profile.display_name || "—"}
                restoresRemaining={profile.restores_remaining_this_month}
                onRestore={() => setRestoreOpen(true)}
              />
            )}
          {peerRemovedMe && (
            <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-center dark:border-neutral-800 dark:bg-neutral-900/60">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                {t.friendChat.peerRemovedTitle}
              </p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                {t.friendChat.peerRemovedHint}
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={onBack}
                  className="rounded-full bg-neutral-100 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                >
                  {t.friendChat.keepConversation}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemove(true)}
                  className="rounded-full bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-700"
                >
                  {t.friendChat.deleteConversation}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {!peerRemovedMe && (
        // Réutilise MessageInput du chat anonyme : on hérite gratuitement
        // du bouton "Vérifier la grammaire" + PII guard + même style.
        // L'envoi passe par notre WS friend handle.
        <MessageInput
          onSend={(body) => {
            if (!wsRef.current) return;
            wsRef.current.send(body);
          }}
          onTyping={() => {
            const now = Date.now();
            if (now - lastTypingSent.current < 2000) return;
            lastTypingSent.current = now;
            wsRef.current?.sendTyping();
          }}
        />
      )}
      <ReportModal
        open={reportOpen}
        peerNick={profile?.display_name ?? null}
        onClose={() => setReportOpen(false)}
        onSubmit={submitReport}
      />
      <StreakRestoreModal
        open={restoreOpen}
        friendId={friendId}
        lostStreak={profile?.lost_streak ?? 0}
        peerName={profile?.display_name ?? "—"}
        onClose={() => setRestoreOpen(false)}
        onRestored={(newStreak) => {
          // Rallume la flamme tout de suite côté initiateur. Le store live
          // est la source de vérité du header (`liveStreak?.streak ??
          // profile.streak`) : sans ce setLiveStreak, la valeur live posée à
          // la perte (0) masquerait `profile.streak` via le `??` (0 n'est ni
          // null ni undefined) et la flamme resterait éteinte.
          setLiveStreak(friendId, newStreak, false);
          setProfile((prev) =>
            prev
              ? { ...prev, streak: newStreak, lost_streak: 0, lost_at: undefined }
              : prev,
          );
        }}
      />
      <RemoveConfirmModal
        open={confirmRemove}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={remove}
      />
      {trans && (
        <TranslationPopover request={trans} onClose={() => setTrans(null)} />
      )}
      {selectionMode && (
        <SelectionBar
          count={selectedIDs.size}
          onCancel={clearSelection}
          onDelete={() => setConfirmBulkDelete(true)}
        />
      )}
      {confirmBulkDelete && (
        <BulkDeleteModal
          count={selectedIDs.size}
          onCancel={() => setConfirmBulkDelete(false)}
          onConfirm={() => {
            setConfirmBulkDelete(false);
            const ids = Array.from(selectedIDs);
            clearSelection();
            // On déclenche les suppressions individuellement — le serveur
            // pousse un frame `msg` par ID, et le state se met à jour
            // au fur et à mesure (replace-by-id).
            for (const id of ids) wsRef.current?.delete(id);
          }}
        />
      )}
    </div>
  );
}

// SelectionBar : barre flottante en bas qui affiche le compteur et le
// bouton de suppression groupée. Visible tant qu'au moins un message
// est sélectionné. Le bouton ✕ annule la sélection.
function SelectionBar({
  count,
  onCancel,
  onDelete,
}: {
  count: number;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  return (
    <div
      role="region"
      aria-label="Sélection"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-6"
    >
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
        <button
          type="button"
          onClick={onCancel}
          aria-label={t.common.cancel}
          className="inline-flex size-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
        >
          ✕
        </button>
        <p className="flex-1 text-sm font-medium text-neutral-900 dark:text-neutral-50">
          {count} {count === 1 ? "message" : "messages"}
        </p>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
        >
          {t.chats.deleteMessage}
        </button>
      </div>
    </div>
  );
}

// BulkDeleteModal : confirmation au style des autres modales du produit.
function BulkDeleteModal({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-3xl bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-xl dark:bg-neutral-950 sm:rounded-3xl sm:pb-6"
      >
        <p className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
          {t.chats.deleteMessage}
        </p>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {count === 1
            ? t.chats.deleteMessageConfirm
            : `Supprimer ${count} messages ?`}
        </p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            {t.chats.deleteMessage}
          </button>
        </div>
      </div>
    </div>
  );
}

// SeenIndicator : petit marqueur "Vu" affiché sous mon dernier message
// quand le peer a déjà lu jusque-là. Style WhatsApp / Instagram —
// double-tick + label, aligné à droite, neutre tant que pas lu.
function SeenIndicator({
  msgs,
  meId,
  peerReadAt,
}: {
  msgs: FriendMessage[];
  meId: number;
  peerReadAt: string | null;
}) {
  if (msgs.length === 0) return null;
  const lastMsg = msgs[msgs.length - 1];
  
  // Si le dernier message du chat n'a pas été envoyé par moi, on n'affiche pas "Vu"
  if (!lastMsg || lastMsg.sender_id !== meId) return null;

  if (!peerReadAt) return null;
  const readTs = new Date(peerReadAt).getTime();
  const sentTs = new Date(lastMsg.sent_at).getTime();
  if (!readTs || readTs < sentTs) return null;

  return (
    <div className="flex justify-end pr-1 pt-0.5">
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
        <DoubleCheckIcon />
        Vu
      </span>
    </div>
  );
}

function DoubleCheckIcon() {
  // Style WhatsApp : 2 cochets superposés, légèrement décalés.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3 text-emerald-500 dark:text-emerald-400"
      aria-hidden
    >
      <path d="M2 12.5l4 4 6-8" />
      <path d="M10 16.5l1.5 1.5 9-11" />
    </svg>
  );
}

// RemoveConfirmModal : remplace l'`alert()` natif par une boîte au style
// du reste du produit. Identique au pattern de la modale Quitter du chat
// anonyme — bouton rouge à droite pour confirmer, escape ferme.
export function RemoveConfirmModal({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-3xl bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-xl dark:bg-neutral-950 sm:rounded-3xl sm:pb-6"
      >
        <p className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
          {t.chats.remove}
        </p>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {t.chats.removeConfirm}
        </p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            {t.chats.remove}
          </button>
        </div>
      </div>
    </div>
  );
}

