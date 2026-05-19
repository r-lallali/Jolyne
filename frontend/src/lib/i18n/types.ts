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
    // Phrase courte qui suit le compteur "scoreboard" (pas le nombre).
    queueWaitingSuffix: FormatString<{ count: number }>;
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
  postChat: {
    title: string;
    titlePeerLeft: FormatString<{ nick: string }>;
    hint: string;
    next: string;
    quit: string;
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
    piiWarn: string;
    piiSendAnyway: string;
    reconnecting: string;
    tapToTranslate: string;
    backGuardTitle: string;
    backGuardHint: FormatString<{ s: number }>;
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
  auth: {
    loginCta: string;
    signupCta: string;
    tabLogin: string;
    tabSignup: string;
    tabForgot: string;
    loginTitle: string;
    signupTitle: string;
    forgotTitle: string;
    loginHint: string;
    signupHint: string;
    forgotHint: string;
    emailPlaceholder: string;
    passwordPlaceholder: string;
    submitLogin: string;
    submitSignup: string;
    submitForgot: string;
    submitReset: string;
    invalidEmail: string;
    passwordTooShort: string;
    invalidCredentials: string;
    emailAlreadyUsed: string;
    emailSent: string;
    emailSentHint: string;
    verifying: string;
    verified: string;
    verifyFailed: string;
    resetTitle: string;
    resetHint: string;
    resetDone: string;
    resetFailed: string;
    backToApp: string;
    logoutCta: string;
    loggedInAs: FormatString<{ email: string }>;
    notVerifiedBadge: string;
    accountCta: string;
  };
  account: {
    title: string;
    photos: string;
    photosHint: string;
    displayName: string;
    displayNamePlaceholder: string;
    bio: string;
    bioPlaceholder: string;
    birthdate: string;
    save: string;
    saving: string;
    saved: string;
    uploading: string;
    uploadError: string;
    deletePhoto: string;
    addPhoto: string;
    mainPhoto: string;
    uploadUnavailable: string;
  };
}
