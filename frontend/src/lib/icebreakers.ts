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
  pt: [
    "Olá! De onde és?",
    "Oi! Há quanto tempo estás a aprender?",
    "O que te levou a praticar?",
  ],
  it: [
    "Ciao! Di dove sei?",
    "Ciao! Da quanto tempo studi?",
    "Cosa ti ha spinto a fare pratica?",
  ],
  zh: [
    "你好！你来自哪里？",
    "嗨！你学了多久了？",
    "是什么让你想练习的？",
  ],
  ja: [
    "こんにちは！どこの出身ですか？",
    "やあ！どれくらい勉強していますか？",
    "練習を始めたきっかけは何ですか？",
  ],
  ko: [
    "안녕하세요! 어디에서 왔어요?",
    "안녕! 얼마나 오래 배웠어요?",
    "연습을 시작한 계기가 뭐예요?",
  ],
  ar: [
    "مرحبًا! من أين أنت؟",
    "أهلًا! منذ متى تتعلّم؟",
    "ما الذي دفعك إلى التدرّب؟",
  ],
};
