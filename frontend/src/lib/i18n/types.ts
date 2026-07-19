// Types et structure des dictionnaires UI.
// Ajout d'une langue = créer un nouveau fichier exporting `Messages` et
// l'enregistrer dans `index.ts`. Tous les dicos doivent rester strictement
// alignés sur ce type — le compilateur garantit qu'aucune clé ne manque.

export type UILang =
  | "fr"
  | "en"
  | "es"
  | "de"
  | "pt"
  | "it"
  | "zh"
  | "ja"
  | "ko"
  | "ar";

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
  nav: {
    meet: string; // onglet chat anonyme (rencontre aléatoire)
    messages: string; // onglet conversations sauvegardées
    courses: string; // onglet cours
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
    // Toggle "Prof IA" sur l'écran de setup : titre + sous-titre explicatif.
    aiTeacher: string;
    aiTeacherHint: string;
    // Compteur Free de messages prof IA restants + libellé quand épuisé.
    aiTeacherRemaining: FormatString<{ count: number }>;
    aiTeacherExhausted: string;
    // Phrase courte qui suit le compteur "scoreboard" (pas le nombre).
    queueWaitingSuffix: FormatString<{ count: number }>;
    // Picker de scénario roleplay du prof IA (visible quand le toggle est
    // coché) : libellé de la section + chip « chat libre » (aucun scénario).
    scenarioLabel: string;
    scenarioFreeChat: string;
  };
  // Scénarios de jeu de rôle du prof IA — doit couvrir les IDs de
  // lib/scenarios.ts (alignés sur le catalogue backend).
  scenarios: Record<
    "restaurant" | "directions" | "interview" | "market" | "doctor",
    { title: string; hint: string }
  >;
  // Session tandem 50/50 (bandeau + poignée de main dans le chat).
  tandem: {
    propose: string;
    waiting: string;
    promptText: string;
    accept: string;
    decline: string;
    activePhase: FormatString<{ lang: string }>;
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
    // Bouton de l'encart "personnes en file" pendant un chat bot de repli :
    // bascule vers un partenaire humain.
    switchToHuman: string;
    // Nudges pédagogiques privés (jamais montrés au peer) : trop de messages
    // en langue native / mauvaise langue pendant une phase tandem.
    nudgePractice: FormatString<{ lang: string }>;
    nudgeTandem: FormatString<{ lang: string }>;
    // Ligne système de célébration quand la mission roleplay est accomplie.
    missionComplete: string;
    // Salle d'attente : lignes système quand le prof IA occupe l'attente
    // (la recherche continue) puis quand un partenaire humain arrive.
    waitingRoomHint: string;
    partnerArrived: FormatString<{ nick: string }>;
    // Lignes système tandem : début de phase / fin de session.
    tandemSwitch: FormatString<{ lang: string }>;
    tandemEnd: string;
    // Tooltip du badge « ≈ B1 » du peer dans le header.
    cefrBadgeTitle: string;
  };
  translate: {
    label: string;
    loading: string;
    unavailable: string;
    genericError: string;
    limitReached: string; // quota quotidien atteint
    limitCta: string; // bouton "Premium" dans le popover
    remaining: FormatString<{ count: number }>; // compteur traductions restantes
    listen: string; // bouton 🔊 : prononcer le texte original (TTS)
    auto: string; // toggle mode immersion (traduction auto des messages)
  };
  vocab: {
    title: string;
    empty: string;
    save: string; // bouton "sauvegarder" dans le popover de traduction
    saved: string; // confirmation après sauvegarde
    saveError: string;
    delete: string; // aria-label suppression d'une entrée
    link: string; // libellé du lien depuis /account
    count: FormatString<{ count: number }>;
    practice: string; // CTA de révision d'une langue depuis le carnet
    // Révision espacée (SRS) : carte d'appel + lecteur de flashcards.
    reviewTitle: string;
    reviewDue: FormatString<{ count: number }>;
    reviewStart: string;
    showAnswer: string;
    gradeAgain: string;
    gradeHard: string;
    gradeGood: string;
    gradeEasy: string;
    reviewDone: string;
    reviewDoneHint: FormatString<{ count: number }>;
  };
  // Mode Cours (apprentissage type Duolingo).
  learn: {
    // Leçon du jour : fautes corrigées des conversations, rejouées en
    // exercices (carte d'appel + lecteur dédié).
    daily: {
      title: string;
      subtitle: FormatString<{ count: number }>;
      question: string;
      next: string;
      doneTitle: string;
      doneHint: FormatString<{ total: number; mistakes: number }>;
      claim: string;
    };
    navLink: string; // entrée de menu vers le mode Cours
    title: string;
    subtitle: string;
    chooseCourse: string;
    courseCta: string; // "Apprendre <langue>" sur une carte de cours
    lessonsCount: FormatString<{ count: number }>;
    // Liste des cours : section « reprendre » (cours entamés, avec avancement)
    // séparée de « tous les cours ».
    yourCourses: string;
    allCourses: string;
    progressLessons: FormatString<{ done: number; total: number }>;
    backToCourses: string;
    backToPath: string;
    // Parcours
    start: string;
    continueLesson: string;
    review: string;
    locked: string;
    lockedHint: string;
    empty: string;
    // Titres d'unités/leçons du curriculum, indexés par slug stable. Affichés
    // dans la langue de l'apprenant (repli sur le titre stocké si slug absent,
    // ex. cours générés ou unités d'écriture).
    courseTitles: Record<string, string>;
    // En-tête de gamification
    streak: string;
    streakDays: FormatString<{ count: number }>;
    streakAtRisk: string;
    hearts: string;
    noHearts: string;
    heartsRegen: FormatString<{ mins: number }>;
    heartsFull: string;
    dailyGoal: string;
    goalProgress: FormatString<{ xp: number; goal: number }>;
    goalReached: string;
    setGoal: string;
    save: string;
    // Exercices
    chooseMeaning: string;
    chooseTarget: string;
    assemble: string;
    matchPairs: string;
    check: string;
    next: string;
    correct: string;
    incorrect: FormatString<{ answer: string }>;
    tapToType: string;
    listen: string;
    // Astuce affichée après vérification d'un assemblage : les jetons
    // deviennent traduisibles au tap (popover de traduction).
    tapTranslateHint: string;
    quit: string;
    quitConfirm: string;
    // Résultats
    lessonComplete: string;
    xpEarned: FormatString<{ xp: number }>;
    accuracy: FormatString<{ percent: number }>;
    streakMilestone: FormatString<{ count: number }>;
    // Récap des mots de la leçon (écoute + ajout au carnet) et révision libre
    // du carnet (mêmes exercices, sans vies ni XP).
    lessonWords: string;
    practice: string;
    practiceNote: string;
    practiceDone: string;
    // Cœurs premium + niveau + plus-de-vies
    premiumHearts: string;
    chooseLevel: string;
    levelHint: string;
    levelBeginner: string;
    levelBasics: string;
    levelElementary: string;
    levelIntermediate: string;
    levelUpperIntermediate: string;
    levelAdvanced: string;
    outOfHeartsTitle: string;
    outOfHeartsHint: string;
    askFriend: string;
    requestSent: string;
    requestQuota: string;
    noFriends: string;
    goPremium: string;
    giveHeart: string;
    incomingHearts: FormatString<{ count: number }>;
    // Succès
    achievements: string;
    achievementUnlocked: string;
    noAchievements: string;
    ach: {
      first_lesson: string;
      lessons_10: string;
      lessons_50: string;
      xp_100: string;
      xp_500: string;
      xp_1000: string;
      streak_3: string;
      streak_7: string;
      streak_30: string;
    };
    // Descriptions « comment débloquer », affichées dans la bulle au clic
    achDesc: {
      first_lesson: string;
      lessons_10: string;
      lessons_50: string;
      xp_100: string;
      xp_500: string;
      xp_1000: string;
      streak_3: string;
      streak_7: string;
      streak_30: string;
    };
    achLocked: string;
    achDone: string;
    // Module d'écriture (apprentissage d'un alphabet/script différent)
    script: {
      badge: string; // étiquette d'unité d'écriture
      unitMastered: string; // tag « maîtrisé » sur une unité d'écriture finie
      newSign: string; // titre de l'intro des nouveaux signes
      introContinue: string; // bouton « c'est parti » après l'intro
      recognize: string; // consigne : voir le signe → choisir le son
      recall: string; // consigne : voir le son → choisir le signe
      listenPrompt: string; // consigne : entendre → choisir le signe
      composePrompt: string; // consigne : assembler le bloc (Hangul)
      formInitial: string; // « au début d'un mot »
      formMedial: string; // « au milieu d'un mot »
      formFinal: string; // « à la fin d'un mot »
      formsPrompt: FormatString<{ position: string }>; // « Quelle forme {position} ? »
      tracePrompt: string; // consigne de tracé
      traceClear: string; // bouton effacer le tracé
      showStrokes: string; // bouton revoir l'ordre des traits
      matchPrompt: string; // consigne d'association signe ↔ son
      diagnosticCta: FormatString<{ script: string }>; // « je lis déjà {script} »
      diagnosticTitle: string; // titre du test de diagnostic
      diagnosticPass: string; // message de réussite
      diagnosticFail: string; // message d'échec
      diagnosticSkip: string; // « sauter quand même »
      names: { ja: string; ko: string; ar: string; zh: string }; // noms des scripts
    };
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
    pt: string;
    it: string;
    zh: string;
    ja: string;
    ko: string;
    ar: string;
  };
  auth: {
    loginCta: string;
    signupCta: string;
    continueWithGoogle: string;
    continueWithApple: string;
    continueWithEmail: string;
    orSeparator: string;
    oauthError: string;
    welcomeTitle: string;
    welcomeHint: string;
    noAccount: string;
    haveAccount: string;
    termsNotice: string;
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
    // Checklist de robustesse du mot de passe (signup / reset), affichée
    // rouge → vert sous le champ. passwordCriteria = erreur à la soumission.
    pwdCriteria: {
      length: string;
      upper: string;
      lower: string;
      digit: string;
    };
    passwordCriteria: string;
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
    // Tooltip du badge « ≈ B1 » (niveau CECRL estimé par l'IA).
    cefrBadgeTitle: string;
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
    reasonScenario: string; // scénario roleplay verrouillé hors Premium
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
    // Tableau comparatif des offres
    compareDaily: string;
    planFree: string;
    planPremium: string;
    featurePartners: string;
    featureTranslations: string;
    featureBot: string;
    unlimited: string;
    currentPlanBadge: string;
    // Pages retour Stripe
    successTitle: string;
    successHint: string;
    cancelTitle: string;
    cancelHint: string;
    backCta: string;
  };
}
