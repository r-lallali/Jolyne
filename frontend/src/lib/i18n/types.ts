// Types et structure des dictionnaires UI.
// Ajout d'une langue = créer un nouveau fichier exporting `Messages` et
// l'enregistrer dans `index.ts`. Tous les dicos doivent rester strictement
// alignés sur ce type — le compilateur garantit qu'aucune clé ne manque.

export type UILang = "fr" | "en" | "es" | "de";

// Texte avec interpolation : on stocke une fonction de format. Garder le
// nombre de placeholders minimal — les vars sont passées par objet, ce qui
// reste lisible côté call site : t.chat.chattingWith({ nick })
export type FormatString<V extends Record<string, string | number>> = (
  v: V,
) => string;

export interface Messages {
  common: {
    cancel: string;
    close: string;
    back: string;
  };
  setup: {
    chooseNick: string;
    nickPlaceholder: string;
    next: string;
    iSpeak: string;
    iWantPractice: string;
    back: string;
    start: string;
    ageGate: string;
    legal: string;
    pseudoBlocked: string;
  };
  searching: {
    findingPeer: string;
    findingPeerHint: string;
    connecting: string;
    connectingHint: string;
    cancel: string;
  };
  farewell: {
    title: string;
    hint: string;
  };
  chat: {
    chattingWith: FormatString<{ nick: string }>;
    sayHello: string;
    placeholder: string;
    sendLabel: string;
    next: string;
    quit: string;
    confirmQuit: string;
    reportLabel: string;
    reportTitle: string;
    peerTyping: FormatString<{ nick: string }>;
    grammarLabel: string;
  };
  translate: {
    label: string;
    loading: string;
    unavailable: string;
    genericError: string;
  };
  grammar: {
    suggestionsCount: FormatString<{ count: number }>;
    nothingToFix: string;
    noErrors: string;
    close: string;
    unavailable: string;
    genericError: string;
  };
  correction: {
    title: FormatString<{ nick: string }>;
    fallbackPeer: string;
    hint: string;
    original: string;
    yourCorrection: string;
    note: string;
    notePlaceholder: string;
    submit: string;
    correctTooltip: string;
    youCorrected: string;
    peerCorrected: FormatString<{ nick: string }>;
    fallbackCorrector: string;
    sentToast: string;
    editLink: string;
  };
  report: {
    title: FormatString<{ nick: string }>;
    hint: string;
    placeholder: string;
    submit: string;
    sent: string;
    sentHint: string;
    tooltip: string;
  };
  errors: {
    queueTimeoutTitle: string;
    queueTimeoutHint: string;
    quotaExceededTitle: string;
    quotaExceededHint: string;
    invalidPseudoTitle: string;
    invalidPseudoHint: string;
    invalidParamTitle: string;
    invalidParamHint: string;
    bannedTitle: string;
    bannedHint: string;
    messageBlockedTitle: string;
    messageBlockedHint: string;
    genericTitle: string;
    genericHint: string;
    retry: string;
  };
  langs: {
    fr: string;
    en: string;
    es: string;
    de: string;
  };
}
