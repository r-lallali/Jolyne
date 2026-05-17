// Petit feedback haptique mobile (Android principalement — iOS Safari
// n'expose pas l'API). Silencieux si non supporté ou si la session n'a
// pas encore eu de geste utilisateur (certains nav exigent un user gesture).
export function buzz(ms: number): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(ms);
    }
  } catch {
    // Pas supporté / bloqué — pas grave.
  }
}
