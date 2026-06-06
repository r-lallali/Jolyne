"use client";

import { AnimatePresence, motion } from "framer-motion";
import { notFound, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PhotoSlot, replacePhoto } from "@/components/account/PhotoSlot";
import { usePhotoDrag } from "@/hooks/usePhotoDrag";
import { BackButton } from "@/components/ui/BackButton";
import { PromptSlot } from "@/components/account/PromptSlot";
import { VerificationCard } from "@/components/account/VerificationCard";
import { PlanComparison } from "@/components/premium/PlanComparison";
import {
  AccountDTO,
  PromptDTO,
  fetchAccount,
  fetchCloudName,
  reorderPhotos,
  updateAccount,
} from "@/lib/account";
import { openPortal } from "@/lib/billing";
import { useT } from "@/lib/i18n";
import { useFlashStore } from "@/stores/flashStore";
import { usePaywallStore } from "@/stores/paywallStore";
import { useUserStore } from "@/stores/userStore";

const MAX_PHOTOS = 6;

// Variants pour le stagger d'entrée des sections de /account. Chaque
// enfant motion.* hérite de `visible` au mount via le parent qui
// déclenche le stagger (staggerChildren + delayChildren).
const sectionVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: "easeOut" as const } },
};

export default function AccountPage() {
  const t = useT();
  const user = useUserStore((s) => s.user);
  const hydrated = useUserStore((s) => s.hydrated);
  const showFlash = useFlashStore((s) => s.show);

  const [account, setAccount] = useState<AccountDTO | null>(null);
  const [cloudName, setCloudName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [savingState, setSavingState] = useState<"idle" | "busy" | "saved">(
    "idle",
  );
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [prompts, setPrompts] = useState<[PromptDTO, PromptDTO, PromptDTO]>([
    { prompt: "", answer: "" },
    { prompt: "", answer: "" },
    { prompt: "", answer: "" },
  ]);
  const router = useRouter();
  const [unsavedOpen, setUnsavedOpen] = useState(false);
  // Drapeau "départ volontaire" : passé à true avant toute navigation
  // programmée (save / back / discard). Neutralise le history.back() du
  // garde-fou dirty (cf. effet ci-dessous) qui, sinon, entre en concurrence
  // avec router.push et peut annuler la navigation (bouton bloqué en
  // "Enregistrement…", l'user reste sur /account).
  const leavingRef = useRef(false);
  // Page de retour : on revient là d'où l'user a ouvert /account (chat
  // anonyme `/` ou liste des conversations `/chats`). Capturée dans
  // sessionStorage par le lien du menu compte ; défaut `/`.
  const [returnTo, setReturnTo] = useState("/");

  useEffect(() => {
    const stored = sessionStorage.getItem("jolyne:accountReturnTo");
    if (stored && stored.startsWith("/") && !stored.startsWith("//")) {
      setReturnTo(stored);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) return;
    Promise.all([fetchAccount(), fetchCloudName().catch(() => "")])
      .then(([acc, cn]) => {
        setAccount(acc);
        setCloudName(cn);
        setDisplayName(acc.profile.display_name);
        setBio(acc.profile.bio);
        setBirthdate(acc.profile.birthdate ?? "");
        if (acc.profile.prompts) {
          setPrompts([
            { ...acc.profile.prompts[0] },
            { ...acc.profile.prompts[1] },
            { ...acc.profile.prompts[2] },
          ]);
        }
      })
      .catch(() => {
        // silent — la page reste vide, le user voit l'état initial
      })
      .finally(() => setLoading(false));
  }, [hydrated, user]);

  // Dirty détection : on compare le state du formulaire au snapshot
  // serveur. Les photos ne sont pas concernées — elles s'enregistrent
  // immédiatement via leurs propres endpoints (upload / delete / reorder).
  const isDirty = useMemo(() => {
    if (!account) return false;
    if (displayName !== account.profile.display_name) return true;
    if (bio !== account.profile.bio) return true;
    if ((birthdate || null) !== (account.profile.birthdate ?? null)) return true;
    const serverPrompts = account.profile.prompts ?? [];
    for (let i = 0; i < 3; i++) {
      const cur = prompts[i] ?? { prompt: "", answer: "" };
      const srv = serverPrompts[i] ?? { prompt: "", answer: "" };
      if (cur.prompt !== srv.prompt || cur.answer !== srv.answer) return true;
    }
    return false;
  }, [account, displayName, bio, birthdate, prompts]);

  // Garde-fou navigateur : refresh / fermeture d'onglet avec modifs en
  // attente → prompt natif. Pas idéal en UX mais aucune façon d'afficher
  // notre propre modal de manière fiable sur `beforeunload`.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // Intercept du back navigateur (swipe iOS, hardware back Android, bouton
  // précédent du browser). On push une entrée d'historique leurre tant
  // qu'on est dirty — au popstate (= geste back déclenché), on consomme
  // l'entrée et on ouvre la modal au lieu de quitter la page.
  useEffect(() => {
    if (!isDirty) return;
    window.history.pushState({ jolyne: "account-dirty" }, "", window.location.href);
    const onPop = () => {
      // On a déjà consommé notre entrée leurre — on reste sur /account et on
      // re-push l'entrée pour intercepter le prochain back aussi.
      setUnsavedOpen(true);
      window.history.pushState({ jolyne: "account-dirty" }, "", window.location.href);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Consomme l'entrée leurre au unmount si elle est toujours là — sauf
      // si on part volontairement : dans ce cas router.push gère déjà la
      // navigation et un history.back() ici la concurrencerait (course qui
      // bloque le bouton et garde l'user sur /account).
      if (!leavingRef.current && window.history.state?.jolyne === "account-dirty") {
        window.history.back();
      }
    };
  }, [isDirty]);

  const persist = async () => {
    const updated = await updateAccount({
      display_name: displayName,
      bio,
      birthdate: birthdate || null,
      prompts,
    });
    setAccount(updated);
    // Confirmation verte affichée sur la page d'arrivée après le retour.
    showFlash(t.account.saved);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingState("busy");
    // Posé avant persist() : setAccount() y fait passer isDirty à false, ce
    // qui déclenche le cleanup du garde-fou dirty avant qu'on atteigne
    // router.push. leavingRef doit donc déjà être à true à ce moment-là.
    leavingRef.current = true;
    try {
      await persist();
      // Enregistrement OK → on renvoie l'user sur la page d'où il vient.
      router.push(returnTo);
    } catch {
      leavingRef.current = false;
      setSavingState("idle");
    }
  };

  const handleBack = () => {
    if (isDirty) {
      setUnsavedOpen(true);
      return;
    }
    leavingRef.current = true;
    router.push(returnTo);
  };

  const saveAndLeave = async () => {
    leavingRef.current = true;
    try {
      await persist();
    } catch {
      // si l'enregistrement échoue, on garde la modal ouverte côté caller
      // — ici on tente simplement de naviguer après une tentative.
    }
    setUnsavedOpen(false);
    router.push(returnTo);
  };

  const discardAndLeave = () => {
    leavingRef.current = true;
    setUnsavedOpen(false);
    router.push(returnTo);
  };

  const photoDrag = usePhotoDrag({
    itemCount: MAX_PHOTOS,
    onReorder: async (fromIndex, toIndex) => {
      if (!account) return;
      const photos = account.photos;
      if (photos.length === 0) return;
      // Build current positions array in display order
      const currentPositions = Array.from({ length: MAX_PHOTOS }, (_, i) => {
        const photo = photos.find((p) => p.position === i + 1);
        return photo ? photo.position : null;
      });
      // Only work with occupied slots
      const occupied = currentPositions.filter((p): p is number => p !== null);
      // fromIndex and toIndex are 0-based grid indices; map to occupied array
      const fromPos = fromIndex + 1;
      const toPos = toIndex + 1;
      const fromOccIdx = occupied.indexOf(fromPos);
      const toOccIdx = occupied.indexOf(toPos);
      if (fromOccIdx === -1) return; // can't drag an empty slot
      // If dropping on empty, ignore
      if (toOccIdx === -1) return;
      // Reorder: remove fromOccIdx, insert at toOccIdx
      const reordered = occupied.slice();
      const moved = reordered.splice(fromOccIdx, 1)[0];
      if (moved === undefined) return;
      reordered.splice(toOccIdx, 0, moved);
      try {
        const updated = await reorderPhotos(reordered);
        setAccount(updated);
      } catch {
        // silent — the grid stays in its original order
      }
    },
  });

  if (!hydrated) {
    return null;
  }
  if (!user) {
    // Page strictement auth-only : on déclenche une vraie 404 pour les
    // visiteurs non connectés (au lieu d'un message inline qui laissait
    // exister une page vide). Comportement attendu par le user.
    notFound();
  }
  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-6 pb-16 pt-[calc(env(safe-area-inset-top)+3.5rem)] sm:pt-16">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">…</p>
      </main>
    );
  }

  const photos = account?.photos ?? [];
  const photoByPos = new Map(photos.map((p) => [p.position, p]));

  return (
    <motion.main
      className="mx-auto max-w-2xl px-6 pb-10 pt-[calc(env(safe-area-inset-top)+3.5rem)] sm:pt-10"
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: 0.06, delayChildren: 0.04 },
        },
      }}
    >
      <motion.div variants={sectionVariants}>
        <BackButton onClick={handleBack} label={t.auth.backToApp} />
      </motion.div>

      <motion.h1
        variants={sectionVariants}
        className="mt-4 text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50"
      >
        {t.account.title}
      </motion.h1>
      <motion.div
        variants={sectionVariants}
        className="mt-1 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400"
      >
        <span className="truncate">{user.email}</span>
        {!user.email_verified && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
            {t.auth.notVerifiedBadge}
          </span>
        )}
      </motion.div>

      <motion.div variants={sectionVariants}>
        <PremiumSection
          isPremium={user.is_premium}
          premiumUntil={user.premium_until}
        />
      </motion.div>

      <motion.section variants={sectionVariants} className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {t.account.photos}
        </h2>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
          {t.account.photosHint}
        </p>
        <div ref={photoDrag.gridRef} className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: MAX_PHOTOS }).map((_, i) => {
            const pos = i + 1;
            const photo = photoByPos.get(pos);
            const itemKey = photo ? photo.public_id : `empty-${pos}`;
            return (
              <div
                key={itemKey}
                className="aspect-square cursor-grab active:cursor-grabbing"
                {...photoDrag.bindSlot(i)}
              >
                <PhotoSlot
                  isDragging={photoDrag.dragIndex === i}
                  isOver={photoDrag.overIndex === i && photoDrag.dragIndex !== i}
                  position={pos}
                  publicId={photo?.public_id}
                  cloudName={cloudName}
                  onUploaded={(publicId) => {
                    setAccount((prev) => {
                      if (!prev) return prev;
                      const alreadyHadPhoto = prev.photos.some((p) => p.position === pos);
                      const isReplacement = pos === 1 && alreadyHadPhoto;
                      const isVerifiedNow = isReplacement ? false : prev.profile.is_verified;
                      return {
                        ...prev,
                        profile: {
                          ...prev.profile,
                          is_verified: isVerifiedNow,
                        },
                        photos: replacePhoto(prev.photos, pos, publicId),
                      };
                    });
                  }}
                  onDeleted={() => {
                    setAccount((prev) => {
                      if (!prev) return prev;
                      const remainingPhotos = prev.photos
                        .filter((p) => p.position !== pos)
                        .map((p) => {
                          if (p.position > pos) {
                            return { ...p, position: p.position - 1 };
                          }
                          return p;
                        });
                      const wasVerified = prev.profile.is_verified;
                      const isVerifiedNow = pos === 1 ? false : wasVerified;
                      return {
                        ...prev,
                        profile: {
                          ...prev.profile,
                          is_verified: isVerifiedNow,
                        },
                        photos: remainingPhotos,
                      };
                    });
                  }}
                />
              </div>
            );
          })}
        </div>
      </motion.section>

      <motion.div variants={sectionVariants} className="mt-8">
        <VerificationCard
          isVerified={account?.profile.is_verified ?? false}
          hasProfilePhoto={photoByPos.has(1)}
          onVerified={() => {
            setAccount((prev) =>
              prev
                ? {
                    ...prev,
                    profile: {
                      ...prev.profile,
                      is_verified: true,
                    },
                  }
                : prev,
            );
          }}
        />
      </motion.div>

      <form onSubmit={save} className="mt-10 space-y-4">
        <motion.div variants={sectionVariants}>
          <Field label={t.account.displayName}>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t.account.displayNamePlaceholder}
              maxLength={40}
              className="w-full rounded-xl bg-neutral-100 px-4 py-3 text-base text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-700"
            />
          </Field>
        </motion.div>
        <motion.div variants={sectionVariants}>
          <Field label={t.account.bio}>
            <AutoGrowTextarea
              value={bio}
              onChange={setBio}
              placeholder={t.account.bioPlaceholder}
              maxLength={280}
            />
          </Field>
        </motion.div>
        <motion.div variants={sectionVariants}>
          <Field label={t.account.birthdate}>
            <input
              type="date"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
              className="w-full rounded-xl bg-neutral-100 px-4 py-3 text-base text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-700"
            />
          </Field>
        </motion.div>

        <motion.section variants={sectionVariants} className="pt-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            {t.account.prompts}
          </h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
            {t.account.promptsHint}
          </p>
          <div className="mt-3 space-y-3">
            {prompts.map((slot, idx) => (
              <PromptSlot
                key={idx}
                slot={slot}
                taken={prompts
                  .map((p, i) => (i === idx ? "" : p.prompt))
                  .filter((k) => k !== "")}
                onChange={(next) => {
                  setPrompts((prev) => {
                    const cp = prev.slice() as [PromptDTO, PromptDTO, PromptDTO];
                    cp[idx] = next;
                    return cp;
                  });
                }}
              />
            ))}
          </div>
        </motion.section>

        <motion.div
          variants={sectionVariants}
          className="flex items-center justify-end pt-2"
        >
          <SaveButton state={savingState} dirty={isDirty} />
        </motion.div>
      </form>
      <UnsavedChangesModal
        open={unsavedOpen}
        onCancel={() => setUnsavedOpen(false)}
        onSave={saveAndLeave}
        onDiscard={discardAndLeave}
      />
    </motion.main>
  );
}

// UnsavedChangesModal : popup quand l'user tente de revenir en arrière
// avec des modifs non enregistrées. Garde le style des autres modales du
// produit (Remove / BulkDelete) — escape ferme, clic backdrop ferme.
function UnsavedChangesModal({
  open,
  onCancel,
  onSave,
  onDiscard,
}: {
  open: boolean;
  onCancel: () => void;
  onSave: () => void;
  onDiscard: () => void;
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
          {t.account.unsavedTitle}
        </p>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {t.account.unsavedHint}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={onSave}
            className="w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
          >
            {t.account.unsavedSave}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="w-full rounded-xl bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {t.account.unsavedDiscard}
          </button>
        </div>
      </div>
    </div>
  );
}

// PremiumSection : carte d'état de l'abonnement. Free → CTA paywall ;
// Premium → date de fin + bouton Customer Portal (gérer / annuler).
function PremiumSection({
  isPremium,
  premiumUntil,
}: {
  isPremium: boolean;
  premiumUntil?: string;
}) {
  const t = useT();
  const showPaywall = usePaywallStore((s) => s.show);
  const [busy, setBusy] = useState(false);

  const manage = async () => {
    setBusy(true);
    try {
      await openPortal(); // redirige vers Stripe (ne revient pas)
    } catch {
      setBusy(false);
    }
  };

  const until = premiumUntil
    ? new Date(premiumUntil).toLocaleDateString()
    : "";

  return (
    <section className="mt-8">
      <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        {t.premium.accountTitle}
      </h2>
      <div className="mt-3">
        <PlanComparison currentPlan={isPremium ? "premium" : "free"} />
        {isPremium ? (
          <div className="mt-4">
            {until && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {t.premium.statusPremiumHint({ date: until })}
              </p>
            )}
            <button
              type="button"
              onClick={manage}
              disabled={busy}
              className="mt-3 w-full rounded-xl bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {busy ? t.premium.redirecting : t.premium.manageCta}
            </button>
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => showPaywall("swipe")}
              className="inline-flex items-center rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
            >
              {t.premium.upgradeCta}
            </button>
            <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
              {t.premium.priceMonthly}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

// AutoGrowTextarea : textarea qui ajuste sa hauteur sur le contenu, pour
// que la bio soit toujours entièrement visible sans scroll interne.
function AutoGrowTextarea({
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      rows={3}
      className="w-full resize-none overflow-hidden rounded-xl bg-neutral-100 px-4 py-3 text-base text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-700"
    />
  );
}

// SaveButton : transition fluide idle → busy (spinner + label) → saved
// (checkmark vert + label) → idle. AnimatePresence avec mode="wait" pour
// que le swap d'icône / fond / texte arrive en un mouvement cohérent.
// Désactivé tant que le formulaire n'est pas dirty — évite les submits
// inutiles + signal visuel clair que rien n'a changé.
function SaveButton({
  state,
  dirty,
}: {
  state: "idle" | "busy" | "saved";
  dirty: boolean;
}) {
  const t = useT();
  const isSaved = state === "saved";
  const isBusy = state === "busy";
  const isDisabled = isBusy || (!dirty && !isSaved);
  return (
    <motion.button
      type="submit"
      disabled={isDisabled}
      animate={{
        backgroundColor: isSaved ? "rgb(16 185 129)" : undefined,
      }}
      transition={{ duration: 0.25 }}
      className="relative flex h-11 min-w-[10rem] items-center justify-center gap-2 overflow-hidden rounded-xl bg-neutral-900 px-5 text-sm font-semibold text-neutral-50 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40 dark:bg-neutral-50 dark:text-neutral-900"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="inline-flex items-center gap-2"
        >
          {isBusy && <Spinner />}
          {isSaved && <CheckIcon />}
          <span>
            {isBusy
              ? t.account.saving
              : isSaved
                ? t.account.saved
                : t.account.save}
          </span>
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

function Spinner() {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2"
        strokeOpacity="0.3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <motion.svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <motion.path
        d="M5 12.5l5 5 9-11"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      />
    </motion.svg>
  );
}

