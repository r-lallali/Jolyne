"use client";

import { notFound } from "next/navigation";
import { LearnMode } from "@/components/learn/LearnMode";
import { useUserStore } from "@/stores/userStore";

// Route /learn : deep-link vers le mode Cours (le même que le 3e onglet de la
// home). Le retour à l'accueil passe par le wordmark global.
export default function LearnRoutePage() {
  const user = useUserStore((s) => s.user);
  const hydrated = useUserStore((s) => s.hydrated);
  if (!hydrated) return null;
  if (!user) notFound();
  return (
    <main className="flex min-h-dvh justify-center">
      <LearnMode />
    </main>
  );
}
