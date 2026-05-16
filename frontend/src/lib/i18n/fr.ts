import type { Messages } from "@/lib/i18n/types";

export const fr: Messages = {
  common: {
    cancel: "Annuler",
    close: "Fermer",
    back: "Retour",
  },
  setup: {
    chooseNick: "Choisis ton pseudo",
    nickPlaceholder: "ton pseudo",
    next: "Suivant",
    iSpeak: "Je parle",
    iWantPractice: "Je veux pratiquer",
    back: "Retour",
    start: "Commencer",
    ageGate:
      "J'ai 16 ans ou plus et j'accepte de discuter avec un inconnu.",
    legal: "Mentions légales",
  },
  searching: {
    findingPeer: "On cherche quelqu'un",
    findingPeerHint:
      "On t'apparie avec un natif qui veut pratiquer ta langue cible.",
    connecting: "Connexion",
    connectingHint: "Quelques secondes — on rétablit le lien avec le serveur.",
    cancel: "Annuler",
  },
  farewell: {
    title: "Merci, à bientôt.",
    hint: "Reviens pratiquer quand tu veux.",
  },
  chat: {
    chattingWith: ({ nick }) => `Tu discutes avec ${nick}`,
    sayHello: "Dis bonjour pour démarrer.",
    placeholder: "Ton message…",
    sendLabel: "Envoyer",
    next: "Suivant",
    quit: "Quitter",
    confirmQuit: "Confirmer ?",
    reportLabel: "Signaler",
    reportTitle: "Signaler ce peer",
    peerTyping: ({ nick }) => `${nick} écrit`,
    grammarLabel: "Vérifier la grammaire",
  },
  translate: {
    label: "Traduire",
    loading: "Traduction…",
    unavailable: "Service indisponible",
    genericError: "Erreur",
  },
  grammar: {
    suggestionsCount: ({ count }) =>
      `${count} suggestion${count > 1 ? "s" : ""}`,
    nothingToFix: "Rien à corriger",
    noErrors: "Aucune faute détectée.",
    close: "Fermer",
    unavailable: "Service indisponible",
    genericError: "Erreur",
  },
  correction: {
    title: ({ nick }) => `Corriger ${nick}`,
    fallbackPeer: "le message",
    hint: "Modifie le message pour proposer ta version. Ajoute une note si tu veux expliquer la règle.",
    original: "Message original",
    yourCorrection: "Ta correction",
    note: "Note (optionnel)",
    notePlaceholder: "Pourquoi cette correction ?",
    submit: "Envoyer la correction",
    correctTooltip: "Corriger",
    youCorrected: "Ta correction",
    peerCorrected: ({ nick }) => `${nick} t'a corrigé`,
    fallbackCorrector: "Ton interlocuteur",
  },
  report: {
    title: ({ nick }) => `Signaler ${nick}`,
    hint: "Décris brièvement le comportement (facultatif). Les derniers messages échangés sont joints automatiquement pour aider à l'examen.",
    placeholder: "Harcèlement, propos inappropriés…",
    submit: "Envoyer le signalement",
    sent: "Signalement envoyé.",
    sentHint: "Merci, on s'en occupe.",
    tooltip: "Signaler ce peer",
  },
  errors: {
    queueTimeoutTitle: "Personne pour le moment.",
    queueTimeoutHint:
      "Peu de monde est en ligne sur cette paire de langues. Réessaie dans quelques instants.",
    quotaExceededTitle: "Tu as utilisé tes 10 « suivant » du jour.",
    quotaExceededHint: "Reviens demain. Premium retire cette limite (à venir).",
    invalidPseudoTitle: "Ce pseudo n'est pas accepté.",
    invalidPseudoHint:
      "Choisis un pseudo entre 3 et 20 caractères, sans terme grossier.",
    invalidParamTitle: "Configuration invalide.",
    invalidParamHint:
      "Vérifie ta paire de langues — toutes les combinaisons ne sont pas encore disponibles.",
    bannedTitle: "Accès suspendu.",
    bannedHint:
      "Ton accès à Jolyne est suspendu. Si tu penses que c'est une erreur, contacte le support.",
    messageBlockedTitle: "Message refusé.",
    messageBlockedHint: "Réessaie ou recommence depuis le début.",
    genericTitle: "Erreur inattendue.",
    genericHint: "Réessaie ou recommence depuis le début.",
    retry: "Réessayer",
  },
  langs: {
    fr: "Français",
    en: "English",
    es: "Español",
    de: "Deutsch",
  },
};
