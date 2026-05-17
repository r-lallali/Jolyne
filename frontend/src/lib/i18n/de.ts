import type { Messages } from "@/lib/i18n/types";

export const de: Messages = {
  common: {
    cancel: "Abbrechen",
    close: "Schließen",
    back: "Zurück",
  },
  setup: {
    chooseNick: "Wähle deinen Nicknamen",
    nickPlaceholder: "dein Nickname",
    next: "Weiter",
    iSpeak: "Ich spreche",
    iWantPractice: "Ich möchte üben",
    back: "Zurück",
    start: "Starten",
    ageGate:
      "Ich bin 16 Jahre oder älter und stimme zu, mit einer fremden Person zu chatten.",
    legal: "Impressum",
    pseudoBlocked: "Dieser Nickname enthält einen gesperrten Begriff.",
    queueWaitingSuffix: ({ count }) =>
      count === 1 ? "Person wartet" : "Personen warten",
  },
  searching: {
    findingPeer: "Suche jemanden",
    findingPeerHint:
      "Wir verbinden dich mit einem Muttersprachler, der deine Zielsprache üben möchte.",
    connecting: "Verbinde",
    connectingHint: "Einen Moment — wir stellen die Verbindung wieder her.",
    cancel: "Abbrechen",
  },
  farewell: {
    title: "Danke, bis bald.",
    hint: "Komm zurück, wann immer du üben möchtest.",
  },
  chat: {
    chattingWith: ({ nick }) => `Du chattest mit ${nick}`,
    sayHello: "Sag Hallo, um zu starten.",
    placeholder: "Deine Nachricht…",
    sendLabel: "Senden",
    next: "Weiter",
    quit: "Beenden",
    confirmQuit: "Bestätigen?",
    reportLabel: "Melden",
    reportTitle: "Diesen Partner melden",
    peerTyping: ({ nick }) => `${nick} schreibt`,
    grammarLabel: "Grammatik prüfen",
    piiWarn: "Deine Nachricht enthält persönliche Infos. Trotzdem senden?",
    piiSendAnyway: "Trotzdem senden",
    reconnecting: "Verbindung wird wiederhergestellt…",
    tapToTranslate: "Tippe ein Wort an, um es zu übersetzen",
    backGuardTitle: "Du verlässt gleich das Gespräch.",
    backGuardHint: ({ s }) => `In ${s} s zurück…`,
  },
  translate: {
    label: "Übersetzen",
    loading: "Übersetze…",
    unavailable: "Dienst nicht verfügbar",
    genericError: "Fehler",
  },
  grammar: {
    suggestionsCount: ({ count }) =>
      `${count} Vorschlag${count > 1 ? "e" : ""}`,
    nothingToFix: "Nichts zu korrigieren",
    noErrors: "Keine Fehler gefunden.",
    close: "Schließen",
    unavailable: "Dienst nicht verfügbar",
    genericError: "Fehler",
  },
  correction: {
    title: ({ nick }) => `${nick} korrigieren`,
    fallbackPeer: "die Nachricht",
    hint: "Bearbeite die Nachricht, um deine Version vorzuschlagen. Füge eine Notiz hinzu, wenn du die Regel erklären möchtest.",
    original: "Originalnachricht",
    yourCorrection: "Deine Korrektur",
    note: "Notiz (optional)",
    notePlaceholder: "Warum diese Korrektur?",
    submit: "Korrektur senden",
    correctTooltip: "Korrigieren",
    youCorrected: "Deine Korrektur",
    peerCorrected: ({ nick }) => `${nick} hat dich korrigiert`,
    fallbackCorrector: "Dein Partner",
    sentToast: "Korrektur gesendet",
    editLink: "Bearbeiten",
  },
  report: {
    title: ({ nick }) => `${nick} melden`,
    hint: "Beschreibe kurz das Verhalten (optional). Die letzten ausgetauschten Nachrichten werden automatisch zur Prüfung beigefügt.",
    placeholder: "Belästigung, unangemessene Inhalte…",
    submit: "Meldung senden",
    sent: "Meldung gesendet.",
    sentHint: "Danke, wir kümmern uns darum.",
    tooltip: "Diesen Partner melden",
  },
  errors: {
    queueTimeoutTitle: "Gerade niemand verfügbar.",
    queueTimeoutHint:
      "Wenige Personen sind in diesem Sprachpaar online. Versuche es in Kürze erneut.",
    quotaExceededTitle: "Du hast deine 10 täglichen „Weiter“ aufgebraucht.",
    quotaExceededHint:
      "Komm morgen wieder. Premium hebt dieses Limit auf (bald).",
    invalidPseudoTitle: "Dieser Nickname ist nicht erlaubt.",
    invalidPseudoHint:
      "Wähle einen Nicknamen zwischen 3 und 20 Zeichen, ohne anstößige Begriffe.",
    invalidParamTitle: "Ungültige Konfiguration.",
    invalidParamHint:
      "Prüfe dein Sprachpaar — nicht alle Kombinationen sind verfügbar.",
    bannedTitle: "Zugang gesperrt.",
    bannedHint:
      "Dein Zugang zu Jolyne ist gesperrt. Wenn du denkst, das ist ein Fehler, kontaktiere den Support.",
    messageBlockedTitle: "Nachricht abgelehnt.",
    messageBlockedHint: "Versuche es erneut oder beginne von vorne.",
    genericTitle: "Unerwarteter Fehler.",
    genericHint: "Versuche es erneut oder beginne von vorne.",
    retry: "Erneut versuchen",
  },
  langs: {
    fr: "Français",
    en: "English",
    es: "Español",
    de: "Deutsch",
  },
};
