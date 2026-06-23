"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { login } from "@/lib/admin";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const ok = await login(email.trim(), password);
      if (ok) {
        window.location.href = "/admin";
      } else {
        setError(
          "Identifiants invalides ou IP non autorisée. Sans détails (sécurité).",
        );
      }
    } catch {
      setError("Erreur réseau. Réessaie.");
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-6 dark:bg-neutral-950">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-neutral-200/80 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
      >
        <header>
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-sm font-bold text-white dark:bg-white dark:text-neutral-900">
              J
            </span>
            <span className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
              Jolyne
              <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                admin
              </span>
            </span>
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Connexion au back-office.
          </p>
        </header>

        <div className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            autoComplete="username"
            required
            className={inputCls}
          />
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mot de passe"
              autoComplete="current-password"
              required
              className={`${inputCls} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              aria-label={
                showPassword
                  ? "Masquer le mot de passe"
                  : "Afficher le mot de passe"
              }
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy || !email || !password}
          className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-white dark:text-neutral-950"
        >
          {busy ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </main>
  );
}
