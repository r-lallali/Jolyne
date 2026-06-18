// Synthèse vocale (TTS) navigateur pour prononcer un mot dans la langue cible.
// Repli silencieux si l'API SpeechSynthesis est absente. Aucun appel réseau —
// 100% local et gratuit.

const BCP47: Record<string, string> = {
  fr: "fr-FR",
  en: "en-US",
  es: "es-ES",
  de: "de-DE",
  pt: "pt-PT",
  it: "it-IT",
  zh: "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
  ar: "ar-SA",
};

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speak(text: string, lang: string): void {
  if (!speechSupported() || !text) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = BCP47[lang] ?? lang;
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  } catch {
    // ignoré : TTS best-effort
  }
}
