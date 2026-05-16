// Phrases d'amorce affichées dans l'écran vide d'un chat fraîchement matché.
// Indexées par la langue *pratiquée* (`wants`) : si je veux pratiquer l'EN
// face à un anglophone, on m'affiche des amorces en anglais que je peux
// envoyer en un clic. Restent volontairement très courtes et neutres.

import type { LangCode } from "@/lib/langs";

export const ICEBREAKERS: Record<LangCode, readonly string[]> = {
  fr: [
    "Salut ! D'où viens-tu ?",
    "Bonjour ! Tu apprends depuis longtemps ?",
    "Hello ! Qu'est-ce qui t'a donné envie de pratiquer ?",
  ],
  en: [
    "Hi! Where are you from?",
    "Hey! How long have you been learning?",
    "Hello! What got you into practicing?",
  ],
  es: [
    "¡Hola! ¿De dónde eres?",
    "¡Hola! ¿Hace cuánto que aprendes?",
    "¿Qué te llevó a practicar?",
  ],
  de: [
    "Hallo! Woher kommst du?",
    "Hi! Wie lange lernst du schon?",
    "Was hat dich zum Üben gebracht?",
  ],
};
