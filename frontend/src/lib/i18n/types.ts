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
    // Ligne système inline dans le flux quand le peer quitte (Next ou
    // déconnexion). Distinct du titre de la PostChatCard qui reste affiché
    // en dessous.
    systemPeerLeft: FormatString<{ nick: string }>;
    systemPeerLeftAnon: string;
    // Ligne système permanente dans le chat ami quand un streak se termine.
    systemStreakLost: FormatString<{ days: number }>;
    // Ligne système permanente quand un ami restaure un streak perdu.
    systemStreakRestored: FormatString<{ days: number }>;
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
    botBadge: string;
    botBadgeTitle: string;
    botIntroTitle: string;
    botIntroHint: string;
    botIntroDismiss: string;
  };
  translate: {
    label: string;
    loading: string;
    unavailable: string;
    genericError: string;
    limitReached: string; // quota quotidien atteint
    limitCta: string; // bouton "Premium" dans le popover
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
    passwordConfirmPlaceholder: string;
    displayNamePlaceholder: string;
    passwordMismatch: string;
    showPassword: string;
    hidePassword: string;
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
    chatsCta: string;
  };
  friendPrompt: {
    title: FormatString<{ nick: string }>;
    hint: string;
    accept: string;
    waiting: string;
    skipped: string;
    made: string;
    openChat: string;
  };
  chats: {
    title: string;
    empty: string;
    placeholder: string;
    send: string;
    back: string;
    remove: string;
    removeConfirm: string;
    mute: string;
    unmute: string;
    report: string;
    menuLabel: string;
    // Édition / suppression d'un message dans une conv amie.
    editMessage: string;
    deleteMessage: string;
    deleteMessageConfirm: string;
    editedSuffix: string; // "Modifié"
    deletedPlaceholder: string; // "Ce message a été supprimé"
    saveEdit: string;
    cancelEdit: string;
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
    prompts: string;
    promptsHint: string;
    pickPrompt: string;
    answerPlaceholder: string;
    clearPrompt: string;
    unsavedTitle: string;
    unsavedHint: string;
    unsavedSave: string;
    unsavedDiscard: string;
    verifyTitle: string;
    verifyHint: string;
    verifyCapture: string;
    verifyCancel: string;
  };
  // Libellés des prompts Q&R style Hinge (clés stables côté DB, voir
  // `lib/prompts.ts`). Toute clé ajoutée dans PROMPT_KEYS doit avoir
  // un libellé ici dans les 4 langues.
  prompts: {
    language_goal: string;
    favorite_word: string;
    dream_destination: string;
    perfect_weekend: string;
    guilty_pleasure: string;
    best_advice: string;
    two_truths_one_lie: string;
    go_to_song: string;
    comfort_food: string;
    hot_take: string;
    if_i_could_meet: string;
    small_thing_makes_me_happy: string;
    im_passionate_about: string;
    im_learning: string;
    im_proud_of: string;
  };
  friendChat: {
    peerRemovedTitle: string;
    peerRemovedHint: string;
    keepConversation: string;
    deleteConversation: string;
    deleteConfirm: string;
  };
  premium: {
    // Modale paywall
    sheetTitle: string;
    reasonSwipe: string;
    reasonTranslate: string;
    reasonBot: string;
    perksTitle: string;
    perkSwipe: string;
    perkTranslate: string;
    perkBot: string;
    upgradeCta: string;
    loginRequired: string;
    loginCta: string;
    later: string;
    redirecting: string;
    // Section /account
    accountTitle: string;
    priceMonthly: string;
    statusFreeTitle: string;
    statusFreeHint: string;
    statusPremiumTitle: string;
    statusPremiumHint: FormatString<{ date: string }>;
    manageCta: string;
    // Pages retour Stripe
    successTitle: string;
    successHint: string;
    cancelTitle: string;
    cancelHint: string;
    backCta: string;
  };
}
