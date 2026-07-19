"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  EmailForm,
  Forgot,
  Landing,
  type EmailMode,
} from "@/components/auth/AuthViews";
import { BackIcon, CloseIcon } from "@/components/auth/icons";
import { SheetHandle } from "@/components/ui/SheetHandle";
import {
  AuthError,
  fetchOAuthProviders,
  forgotPassword,
  login as apiLogin,
  signup as apiSignup,
  startOAuth,
  type OAuthProvider,
} from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { track } from "@/lib/track";
import { useUserStore } from "@/stores/userStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

// Vues de la feuille, en profondeur croissante : landing (choix social /
// e-mail) → email (login ou signup) → forgot. Le sens du slide en dérive.
type View = "landing" | "email" | "forgot";

const DEPTH: Record<View, number> = { landing: 0, email: 1, forgot: 2 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;

// Providers OAuth configurés côté backend. Cache module-level : la config ne
// change pas durant la session JS, un seul fetch même si la sheet se rouvre.
let oauthProvidersCache: OAuthProvider[] | null = null;

// Feuille d'authentification : bottom-sheet (mobile) / carte centrée
// (desktop). Social-first — Google / Apple en tête, l'e-mail en chemin
// secondaire avec bascule connexion / inscription et mot de passe oublié.
// z-[80] : au-dessus du PaywallModal (z-[70]) qui peut l'ouvrir.
export function LoginSheet({ open, onClose }: Props) {
  const t = useT();
  const setUser = useUserStore((s) => s.setUser);
  const [view, setView] = useState<View>("landing");
  const [dir, setDir] = useState(1);
  const [emailMode, setEmailMode] = useState<EmailMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [providers, setProviders] = useState<OAuthProvider[] | null>(
    oauthProvidersCache,
  );

  useEffect(() => {
    if (!open) {
      setView("landing");
      setDir(1);
      setEmailMode("login");
      setEmail("");
      setPassword("");
      setPasswordConfirm("");
      setDisplayName("");
      setShowPwd(false);
      setSent(false);
      setBusy(false);
      setErr(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || oauthProvidersCache !== null) return;
    let alive = true;
    void fetchOAuthProviders().then((list) => {
      oauthProvidersCache = list;
      if (alive) setProviders(list);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  // Aucun provider configuré → la vue landing ne propose que l'e-mail,
  // autant sauter l'étape.
  useEffect(() => {
    if (open && view === "landing" && providers !== null && providers.length === 0) {
      setView("email");
    }
  }, [open, view, providers]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const goTo = (next: View) => {
    setDir(DEPTH[next] > DEPTH[view] ? 1 : -1);
    setView(next);
    setErr(null);
    setSent(false);
  };

  const switchEmailMode = (next: EmailMode) => {
    if (next === "signup" && emailMode !== "signup") void track("signup_started");
    setEmailMode(next);
    setErr(null);
    setPassword("");
    setPasswordConfirm("");
    setShowPwd(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setErr(t.auth.invalidEmail);
      return;
    }
    if (view === "email" && password.length < PASSWORD_MIN) {
      setErr(t.auth.passwordTooShort);
      return;
    }
    if (view === "email" && emailMode === "signup" && password !== passwordConfirm) {
      setErr(t.auth.passwordMismatch);
      return;
    }
    setBusy(true);
    try {
      if (view === "forgot") {
        await forgotPassword(trimmed);
        setSent(true);
      } else if (emailMode === "login") {
        setUser(await apiLogin(trimmed, password));
        onClose();
      } else {
        setUser(await apiSignup(trimmed, password, displayName.trim()));
        onClose();
      }
    } catch (e) {
      if (e instanceof AuthError && emailMode === "login" && e.status === 401) {
        setErr(t.auth.invalidCredentials);
      } else if (e instanceof AuthError && e.status === 409) {
        setErr(t.auth.emailAlreadyUsed);
      } else {
        setErr(t.auth.oauthError);
      }
    } finally {
      setBusy(false);
    }
  };

  const oauth = (provider: OAuthProvider) => {
    // La navigation quitte la page — busy neutralise juste le double-clic.
    setBusy(true);
    void startOAuth(provider);
  };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <motion.form
        initial={{ y: 32, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="relative w-full max-w-sm overflow-hidden rounded-t-3xl bg-white px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 shadow-2xl dark:bg-neutral-950 sm:rounded-3xl sm:px-7 sm:pb-6"
      >
        <SheetHandle />
        {view !== "landing" && (
          <button
            type="button"
            onClick={() => goTo(view === "forgot" ? "email" : "landing")}
            aria-label={t.common.back}
            className="absolute left-3 top-3 inline-flex size-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
          >
            <BackIcon />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
        >
          <CloseIcon />
        </button>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view + (view === "email" ? emailMode : "")}
            initial={{ x: dir * 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir * -24, opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            {view === "landing" && (
              <Landing
                t={t}
                providers={providers ?? []}
                busy={busy}
                onOAuth={oauth}
                onEmail={() => goTo("email")}
              />
            )}
            {view === "email" && (
              <EmailForm
                t={t}
                mode={emailMode}
                busy={busy}
                err={err}
                fields={{ email, displayName, password, passwordConfirm, showPwd }}
                set={{ setEmail, setDisplayName, setPassword, setPasswordConfirm, setShowPwd }}
                onSwitchMode={switchEmailMode}
                onForgot={() => goTo("forgot")}
              />
            )}
            {view === "forgot" && (
              <Forgot
                t={t}
                sent={sent}
                busy={busy}
                err={err}
                email={email}
                setEmail={setEmail}
                onDone={onClose}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </motion.form>
    </motion.div>
  );
}
