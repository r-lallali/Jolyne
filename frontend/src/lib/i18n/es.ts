import type { Messages } from "@/lib/i18n/types";

export const es: Messages = {
  common: {
    cancel: "Cancelar",
    close: "Cerrar",
    back: "Atrás",
  },
  setup: {
    chooseNick: "Elige tu nombre",
    nickPlaceholder: "tu nombre",
    next: "Siguiente",
    iSpeak: "Hablo",
    iWantPractice: "Quiero practicar",
    back: "Atrás",
    start: "Comenzar",
    ageGate: "Tengo 16 años o más y acepto chatear con un desconocido.",
    legal: "Aviso legal",
    pseudoBlocked: "Este nombre contiene un término bloqueado.",
  },
  searching: {
    findingPeer: "Buscando a alguien",
    findingPeerHint:
      "Te emparejamos con un nativo que quiere practicar tu idioma objetivo.",
    connecting: "Conectando",
    connectingHint: "Un momento — reconectando con el servidor.",
    cancel: "Cancelar",
  },
  farewell: {
    title: "Gracias, hasta pronto.",
    hint: "Vuelve a practicar cuando quieras.",
  },
  chat: {
    chattingWith: ({ nick }) => `Estás chateando con ${nick}`,
    sayHello: "Saluda para empezar.",
    placeholder: "Tu mensaje…",
    sendLabel: "Enviar",
    next: "Siguiente",
    quit: "Salir",
    confirmQuit: "¿Confirmar?",
    reportLabel: "Reportar",
    reportTitle: "Reportar a este usuario",
    peerTyping: ({ nick }) => `${nick} está escribiendo`,
    grammarLabel: "Revisar la gramática",
  },
  translate: {
    label: "Traducir",
    loading: "Traduciendo…",
    unavailable: "Servicio no disponible",
    genericError: "Error",
  },
  grammar: {
    suggestionsCount: ({ count }) =>
      `${count} sugerencia${count > 1 ? "s" : ""}`,
    nothingToFix: "Nada que corregir",
    noErrors: "No se encontraron errores.",
    close: "Cerrar",
    unavailable: "Servicio no disponible",
    genericError: "Error",
  },
  correction: {
    title: ({ nick }) => `Corregir a ${nick}`,
    fallbackPeer: "el mensaje",
    hint: "Edita el mensaje para proponer tu versión. Añade una nota si quieres explicar la regla.",
    original: "Mensaje original",
    yourCorrection: "Tu corrección",
    note: "Nota (opcional)",
    notePlaceholder: "¿Por qué esta corrección?",
    submit: "Enviar la corrección",
    correctTooltip: "Corregir",
    youCorrected: "Tu corrección",
    peerCorrected: ({ nick }) => `${nick} te corrigió`,
    fallbackCorrector: "Tu interlocutor",
    sentToast: "Corrección enviada",
    editLink: "Editar",
  },
  report: {
    title: ({ nick }) => `Reportar a ${nick}`,
    hint: "Describe brevemente el comportamiento (opcional). Los últimos mensajes intercambiados se adjuntan automáticamente para ayudar al examen.",
    placeholder: "Acoso, contenido inapropiado…",
    submit: "Enviar reporte",
    sent: "Reporte enviado.",
    sentHint: "Gracias, nos ocupamos.",
    tooltip: "Reportar a este usuario",
  },
  errors: {
    queueTimeoutTitle: "Nadie disponible por ahora.",
    queueTimeoutHint:
      "Hay poca gente conectada en este par de idiomas. Inténtalo de nuevo en unos instantes.",
    quotaExceededTitle: "Has usado tus 10 «siguientes» del día.",
    quotaExceededHint:
      "Vuelve mañana. Premium quita este límite (próximamente).",
    invalidPseudoTitle: "Este nombre no se acepta.",
    invalidPseudoHint:
      "Elige un nombre entre 3 y 20 caracteres, sin términos groseros.",
    invalidParamTitle: "Configuración inválida.",
    invalidParamHint:
      "Comprueba tu par de idiomas — no todas las combinaciones están abiertas todavía.",
    bannedTitle: "Acceso suspendido.",
    bannedHint:
      "Tu acceso a Jolyne está suspendido. Si crees que es un error, contacta con soporte.",
    messageBlockedTitle: "Mensaje rechazado.",
    messageBlockedHint: "Inténtalo de nuevo o vuelve a empezar.",
    genericTitle: "Error inesperado.",
    genericHint: "Inténtalo de nuevo o vuelve a empezar.",
    retry: "Reintentar",
  },
  langs: {
    fr: "Français",
    en: "English",
    es: "Español",
    de: "Deutsch",
  },
};
