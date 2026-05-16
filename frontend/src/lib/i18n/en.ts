import type { Messages } from "@/lib/i18n/types";

export const en: Messages = {
  common: {
    cancel: "Cancel",
    close: "Close",
    back: "Back",
  },
  setup: {
    chooseNick: "Pick a nickname",
    nickPlaceholder: "your nickname",
    next: "Next",
    iSpeak: "I speak",
    iWantPractice: "I want to practice",
    back: "Back",
    start: "Start",
    ageGate:
      "I'm 16 or older and I agree to chat with a stranger.",
    legal: "Legal notice",
  },
  searching: {
    findingPeer: "Finding someone",
    findingPeerHint:
      "We're pairing you with a native who wants to practice your target language.",
    connecting: "Connecting",
    connectingHint: "Just a moment — reconnecting to the server.",
    cancel: "Cancel",
  },
  farewell: {
    title: "Thanks, see you soon.",
    hint: "Come back to practice whenever you want.",
  },
  chat: {
    chattingWith: ({ nick }) => `You're chatting with ${nick}`,
    sayHello: "Say hi to get started.",
    placeholder: "Your message…",
    sendLabel: "Send",
    next: "Next",
    quit: "Quit",
    confirmQuit: "Confirm?",
    reportLabel: "Report",
    reportTitle: "Report this peer",
    peerTyping: ({ nick }) => `${nick} is typing`,
    grammarLabel: "Check grammar",
  },
  translate: {
    label: "Translate",
    loading: "Translating…",
    unavailable: "Service unavailable",
    genericError: "Error",
  },
  grammar: {
    suggestionsCount: ({ count }) =>
      `${count} suggestion${count > 1 ? "s" : ""}`,
    nothingToFix: "Nothing to fix",
    noErrors: "No mistakes found.",
    close: "Close",
    unavailable: "Service unavailable",
    genericError: "Error",
  },
  correction: {
    title: ({ nick }) => `Correct ${nick}`,
    fallbackPeer: "the message",
    hint: "Edit the message to suggest your version. Add a note if you want to explain the rule.",
    original: "Original message",
    yourCorrection: "Your correction",
    note: "Note (optional)",
    notePlaceholder: "Why this correction?",
    submit: "Send the correction",
    correctTooltip: "Correct",
    youCorrected: "Your correction",
    peerCorrected: ({ nick }) => `${nick} corrected you`,
    fallbackCorrector: "Your partner",
    sentToast: "Correction sent",
    editLink: "Edit",
  },
  report: {
    title: ({ nick }) => `Report ${nick}`,
    hint: "Briefly describe the behaviour (optional). The last messages exchanged are attached automatically to help review.",
    placeholder: "Harassment, inappropriate content…",
    submit: "Send report",
    sent: "Report sent.",
    sentHint: "Thanks, we'll look into it.",
    tooltip: "Report this peer",
  },
  errors: {
    queueTimeoutTitle: "Nobody around right now.",
    queueTimeoutHint:
      "Few people are online on this language pair. Try again in a moment.",
    quotaExceededTitle: "You've used your 10 daily \"next\".",
    quotaExceededHint: "Come back tomorrow. Premium removes this limit (soon).",
    invalidPseudoTitle: "This nickname isn't accepted.",
    invalidPseudoHint:
      "Pick a nickname between 3 and 20 characters, no rude words.",
    invalidParamTitle: "Invalid configuration.",
    invalidParamHint:
      "Check your language pair — not every combination is open yet.",
    bannedTitle: "Access suspended.",
    bannedHint:
      "Your access to Jolyne is suspended. If you think this is a mistake, contact support.",
    messageBlockedTitle: "Message rejected.",
    messageBlockedHint: "Try again or restart from the beginning.",
    genericTitle: "Unexpected error.",
    genericHint: "Try again or restart from the beginning.",
    retry: "Retry",
  },
  langs: {
    fr: "Français",
    en: "English",
    es: "Español",
    de: "Deutsch",
  },
};
