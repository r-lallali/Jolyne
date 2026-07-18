"use client";

import { useEffect } from "react";
import { useT } from "@/lib/i18n";
import { useFlashStore } from "@/stores/flashStore";
import { useUserStore } from "@/stores/userStore";

// Composant invisible monté dans le layout : déclenche fetchMe au boot
// pour hydrater l'état utilisateur depuis le cookie HttpOnly.
export function AuthBootstrap() {
  const t = useT();
  useEffect(() => {
    useUserStore.getState().bootstrap();
  }, []);
  // Retour du flow OAuth : le callback backend redirige vers `/?oauth=ok`
  // (session posée — fetchMe ci-dessus la voit) ou `/?oauth=error`. On
  // affiche le toast d'échec puis on remet l'URL à plat dans les deux cas.
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("oauth");
    if (!result) return;
    if (result === "error") useFlashStore.getState().show(t.auth.oauthError);
    url.searchParams.delete("oauth");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [t]);
  return null;
}
