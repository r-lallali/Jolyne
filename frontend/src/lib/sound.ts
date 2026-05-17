// Petit chime généré au runtime via WebAudio (deux sinus très courts).
// Pas d'asset à charger, pas de licence à gérer. Silencieux si le navigateur
// bloque l'autoplay (le user devra avoir fait un geste sur la page au
// moins une fois, ce qui est déjà le cas après le clic "Commencer").

export function playPeerChime(): void {
  if (typeof window === "undefined") return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const tone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // Enveloppe : montée rapide, descente douce.
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.12, now + start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur);
    };
    tone(880, 0, 0.18);
    tone(660, 0.08, 0.22);
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 800);
  } catch {
    // Bloqué (autoplay policy / privacy mode) — pas grave, le titre
    // d'onglet sert déjà d'indicateur visuel.
  }
}
