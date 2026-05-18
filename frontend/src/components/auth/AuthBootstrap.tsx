"use client";

import { useEffect } from "react";
import { useUserStore } from "@/stores/userStore";

// Composant invisible monté dans le layout : déclenche fetchMe au boot
// pour hydrater l'état utilisateur depuis le cookie HttpOnly.
export function AuthBootstrap() {
  useEffect(() => {
    useUserStore.getState().bootstrap();
  }, []);
  return null;
}
