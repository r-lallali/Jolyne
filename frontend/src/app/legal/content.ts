// Contenu localisé des mentions légales.
//
// Le texte juridique est volumineux et structuré (titres, listes, gras,
// liens) — on le garde hors des dicos UI courts (`lib/i18n/*`) pour ne pas
// les alourdir. La page sélectionne le doc via `useUILang()`, donc la page
// suit la même langue que le reste de l'app.
//
// Modèle de données : chaque section a un titre et des blocs (paragraphe,
// paragraphe atténué, ou liste). Le texte inline est une suite de segments
// pour gérer le gras et les liens sans dupliquer le markup par langue.

import type { UILang } from "@/lib/i18n/types";

// Un segment de texte inline.
export type Seg =
  | string // texte simple
  | { b: string } // gras
  | { link: string; href: string }; // lien

export type Inline = Seg[];

export type Block =
  | { kind: "p"; content: Inline }
  | { kind: "pMuted"; content: Inline }
  | { kind: "ul"; items: Inline[] };

export interface LegalSection {
  heading: string;
  blocks: Block[];
}

export interface LegalDoc {
  title: string;
  updated: string;
  sections: LegalSection[];
}

const CONTACT = "lallaliralys@gmail.com";
const MAILTO = `mailto:${CONTACT}`;
const email: Seg = { link: CONTACT, href: MAILTO };

const fr: LegalDoc = {
  title: "Mentions légales",
  updated: "Dernière mise à jour : 14 mai 2026",
  sections: [
    {
      heading: "Éditeur",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne est un service de chat anonyme exploité par Ralys, particulier domicilié en France. Contact : ",
            email,
            ".",
          ],
        },
        {
          kind: "pMuted",
          content: [
            "Hébergement : OVH SAS, 2 rue Kellermann, 59100 Roubaix, France.",
          ],
        },
      ],
    },
    {
      heading: "Conditions d'utilisation",
      blocks: [
        {
          kind: "ul",
          items: [
            [
              "Le service est réservé aux personnes âgées de ",
              { b: "16 ans ou plus" },
              ". L'accès est conditionné à l'acceptation explicite de cette condition d'âge avant chaque session.",
            ],
            [
              "Sont strictement interdits : propos haineux, discriminatoires, menaces, harcèlement, contenu à caractère sexuel explicite, partage d'informations personnelles d'autrui (doxing), spam, ou toute incitation à la violence.",
            ],
            [
              "Tout signalement déclenche une revue humaine et peut entraîner une suspension temporaire ou définitive du compte/appareil. Les bannissements définitifs ne sont prononcés qu'après examen par un modérateur humain.",
            ],
            [
              "L'utilisateur s'engage à respecter les lois en vigueur dans son pays de résidence.",
            ],
          ],
        },
      ],
    },
    {
      heading: "Données personnelles (RGPD)",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne minimise au maximum la collecte de données. Concrètement :",
          ],
        },
        {
          kind: "ul",
          items: [
            [
              { b: "Le contenu des messages n'est jamais conservé ni journalisé." },
              " Il transite uniquement entre les deux participants pendant la durée de la conversation.",
            ],
            [
              "Un identifiant d'appareil (fingerprint) est calculé côté client et utilisé pour appliquer les quotas gratuits et empêcher le contournement de bannissement. Il n'est jamais associé à un nom ou un email côté serveur.",
            ],
            [
              "L'IP est hashée avant tout enregistrement applicatif. Les logs serveur ne contiennent que des métadonnées techniques (durée de session, paire de langues, code retour).",
            ],
            [
              "En cas de signalement, les N derniers messages capturés sont chiffrés au repos et purgés automatiquement après 90 jours.",
            ],
            [
              { b: "Bot prof IA :" },
              " si aucun partenaire humain n'est disponible au bout de 10 secondes, un bot prof IA (badge « 🤖 Prof IA » affiché côté chat) prend la main pour que tu puisses pratiquer. Le contenu des messages échangés avec ce bot est transmis en temps réel à Anthropic (éditeur du modèle Claude) afin de générer ses réponses. Aucun identifiant utilisateur n'est joint à ces appels, et Anthropic ne conserve pas ces échanges pour entraîner ses modèles (politique commerciale standard). Si tu ne souhaites pas que tes messages soient traités par Anthropic, ne continue pas la conversation après l'apparition du badge — clique sur « Suivant » pour ré-essayer un match humain.",
            ],
            [
              { b: "Abonnement Premium :" },
              " le paiement est traité par Stripe (Stripe Payments Europe). Jolyne ne voit ni ne stocke jamais tes données bancaires — seuls un identifiant client Stripe, le statut de ton abonnement et sa date de fin sont conservés pour débloquer les fonctionnalités Premium. Tu peux gérer ou résilier ton abonnement à tout moment depuis ton compte.",
            ],
          ],
        },
        {
          kind: "p",
          content: [
            { b: "Droit à l'effacement" },
            " : tu peux demander la suppression de toute donnée te concernant en écrivant à l'adresse de contact ci-dessus. Réponse sous 30 jours.",
          ],
        },
      ],
    },
    {
      heading: "Modération et Digital Services Act",
      blocks: [
        {
          kind: "p",
          content: [
            "Point de contact pour les signalements de contenus illégaux, les demandes d'information des autorités, ou toute question relative à la modération :",
          ],
        },
        { kind: "p", content: [email] },
        {
          kind: "pMuted",
          content: [
            "Conformément au règlement (UE) 2022/2065 sur les services numériques (DSA), Jolyne traite les signalements crédibles dans un délai raisonnable. Tu peux contester un bannissement en répondant à l'email de notification.",
          ],
        },
      ],
    },
    {
      heading: "Cookies et stockage local",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne n'utilise ",
            { b: "aucun cookie de tracking" },
            ". Le navigateur stocke localement :",
          ],
        },
        {
          kind: "ul",
          items: [
            [
              "Ton pseudo et tes préférences de langue (pour les retrouver à ta prochaine visite).",
            ],
            ["Ton fingerprint d'appareil (pour les quotas)."],
            ["Ta préférence de thème (clair/sombre)."],
          ],
        },
        {
          kind: "p",
          content: [
            "Tu peux tout effacer en vidant le stockage local de ton navigateur pour ce site.",
          ],
        },
      ],
    },
  ],
};

const en: LegalDoc = {
  title: "Legal notice",
  updated: "Last updated: May 14, 2026",
  sections: [
    {
      heading: "Publisher",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne is an anonymous chat service operated by Ralys, an individual based in France. Contact: ",
            email,
            ".",
          ],
        },
        {
          kind: "pMuted",
          content: [
            "Hosting: OVH SAS, 2 rue Kellermann, 59100 Roubaix, France.",
          ],
        },
      ],
    },
    {
      heading: "Terms of use",
      blocks: [
        {
          kind: "ul",
          items: [
            [
              "The service is reserved for people aged ",
              { b: "16 or older" },
              ". Access requires explicit acceptance of this age condition before each session.",
            ],
            [
              "The following are strictly prohibited: hateful or discriminatory remarks, threats, harassment, sexually explicit content, sharing other people's personal information (doxing), spam, or any incitement to violence.",
            ],
            [
              "Any report triggers a human review and may lead to a temporary or permanent suspension of the account/device. Permanent bans are only issued after review by a human moderator.",
            ],
            [
              "Users agree to comply with the laws in force in their country of residence.",
            ],
          ],
        },
      ],
    },
    {
      heading: "Personal data (GDPR)",
      blocks: [
        {
          kind: "p",
          content: ["Jolyne minimizes data collection as much as possible. Specifically:"],
        },
        {
          kind: "ul",
          items: [
            [
              { b: "Message content is never stored or logged." },
              " It passes only between the two participants for the duration of the conversation.",
            ],
            [
              "A device identifier (fingerprint) is computed on the client side and used to enforce free quotas and prevent ban circumvention. It is never linked to a name or email on the server side.",
            ],
            [
              "Your IP is hashed before any application-level storage. Server logs contain only technical metadata (session duration, language pair, return code).",
            ],
            [
              "In the event of a report, the last N captured messages are encrypted at rest and automatically purged after 90 days.",
            ],
            [
              { b: "AI tutor bot:" },
              " if no human partner is available after 10 seconds, an AI tutor bot (badge « 🤖 AI Tutor » shown in the chat) takes over so you can keep practicing. The content of the messages exchanged with this bot is sent in real time to Anthropic (maker of the Claude model) to generate its replies. No user identifier is attached to these calls, and Anthropic does not retain these exchanges to train its models (standard commercial policy). If you do not want your messages processed by Anthropic, do not continue the conversation after the badge appears — tap « Next » to try a human match again.",
            ],
            [
              { b: "Premium subscription:" },
              " payment is handled by Stripe (Stripe Payments Europe). Jolyne never sees or stores your banking details — only a Stripe customer ID, your subscription status and its end date are kept to unlock Premium features. You can manage or cancel your subscription at any time from your account.",
            ],
          ],
        },
        {
          kind: "p",
          content: [
            { b: "Right to erasure:" },
            " you can request the deletion of any data concerning you by writing to the contact address above. Reply within 30 days.",
          ],
        },
      ],
    },
    {
      heading: "Moderation and the Digital Services Act",
      blocks: [
        {
          kind: "p",
          content: [
            "Point of contact for reports of illegal content, information requests from authorities, or any question relating to moderation:",
          ],
        },
        { kind: "p", content: [email] },
        {
          kind: "pMuted",
          content: [
            "In accordance with Regulation (EU) 2022/2065 on digital services (DSA), Jolyne handles credible reports within a reasonable time. You can appeal a ban by replying to the notification email.",
          ],
        },
      ],
    },
    {
      heading: "Cookies and local storage",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne uses ",
            { b: "no tracking cookies" },
            ". Your browser stores locally:",
          ],
        },
        {
          kind: "ul",
          items: [
            [
              "Your nickname and language preferences (so they are remembered on your next visit).",
            ],
            ["Your device fingerprint (for quotas)."],
            ["Your theme preference (light/dark)."],
          ],
        },
        {
          kind: "p",
          content: [
            "You can erase everything by clearing your browser's local storage for this site.",
          ],
        },
      ],
    },
  ],
};

const es: LegalDoc = {
  title: "Aviso legal",
  updated: "Última actualización: 14 de mayo de 2026",
  sections: [
    {
      heading: "Editor",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne es un servicio de chat anónimo gestionado por Ralys, un particular domiciliado en Francia. Contacto: ",
            email,
            ".",
          ],
        },
        {
          kind: "pMuted",
          content: [
            "Alojamiento: OVH SAS, 2 rue Kellermann, 59100 Roubaix, Francia.",
          ],
        },
      ],
    },
    {
      heading: "Condiciones de uso",
      blocks: [
        {
          kind: "ul",
          items: [
            [
              "El servicio está reservado a las personas de ",
              { b: "16 años o más" },
              ". El acceso está condicionado a la aceptación explícita de esta condición de edad antes de cada sesión.",
            ],
            [
              "Quedan estrictamente prohibidos: los comentarios de odio o discriminatorios, las amenazas, el acoso, el contenido sexual explícito, la difusión de información personal de terceros (doxing), el spam o cualquier incitación a la violencia.",
            ],
            [
              "Toda denuncia activa una revisión humana y puede conllevar la suspensión temporal o definitiva de la cuenta o del dispositivo. Los bloqueos definitivos solo se aplican tras la revisión de un moderador humano.",
            ],
            [
              "El usuario se compromete a respetar las leyes vigentes en su país de residencia.",
            ],
          ],
        },
      ],
    },
    {
      heading: "Datos personales (RGPD)",
      blocks: [
        {
          kind: "p",
          content: ["Jolyne reduce al máximo la recopilación de datos. En concreto:"],
        },
        {
          kind: "ul",
          items: [
            [
              { b: "El contenido de los mensajes nunca se conserva ni se registra." },
              " Solo circula entre los dos participantes mientras dura la conversación.",
            ],
            [
              "Se calcula un identificador de dispositivo (fingerprint) en el lado del cliente, que se usa para aplicar las cuotas gratuitas e impedir la elusión de bloqueos. Nunca se asocia a un nombre o un correo en el lado del servidor.",
            ],
            [
              "La IP se cifra mediante hash antes de cualquier registro de la aplicación. Los registros del servidor solo contienen metadatos técnicos (duración de la sesión, par de idiomas, código de respuesta).",
            ],
            [
              "En caso de denuncia, los últimos N mensajes capturados se cifran en reposo y se eliminan automáticamente tras 90 días.",
            ],
            [
              { b: "Bot profe IA:" },
              " si no hay ninguna persona disponible al cabo de 10 segundos, un bot profe IA (insignia « 🤖 Profe IA » mostrada en el chat) toma el relevo para que puedas practicar. El contenido de los mensajes intercambiados con este bot se transmite en tiempo real a Anthropic (creadora del modelo Claude) para generar sus respuestas. No se adjunta ningún identificador de usuario a estas llamadas, y Anthropic no conserva estos intercambios para entrenar sus modelos (política comercial estándar). Si no quieres que Anthropic procese tus mensajes, no continúes la conversación tras la aparición de la insignia: pulsa « Siguiente » para volver a intentar un emparejamiento humano.",
            ],
            [
              { b: "Suscripción Premium:" },
              " el pago lo gestiona Stripe (Stripe Payments Europe). Jolyne nunca ve ni almacena tus datos bancarios; solo se conservan un identificador de cliente de Stripe, el estado de tu suscripción y su fecha de finalización para desbloquear las funciones Premium. Puedes gestionar o cancelar tu suscripción en cualquier momento desde tu cuenta.",
            ],
          ],
        },
        {
          kind: "p",
          content: [
            { b: "Derecho de supresión:" },
            " puedes solicitar la eliminación de cualquier dato que te concierna escribiendo a la dirección de contacto anterior. Respuesta en un plazo de 30 días.",
          ],
        },
      ],
    },
    {
      heading: "Moderación y Reglamento de Servicios Digitales",
      blocks: [
        {
          kind: "p",
          content: [
            "Punto de contacto para denunciar contenidos ilegales, para las solicitudes de información de las autoridades o para cualquier cuestión relativa a la moderación:",
          ],
        },
        { kind: "p", content: [email] },
        {
          kind: "pMuted",
          content: [
            "De conformidad con el Reglamento (UE) 2022/2065 relativo a los servicios digitales (DSA), Jolyne tramita las denuncias creíbles en un plazo razonable. Puedes recurrir un bloqueo respondiendo al correo de notificación.",
          ],
        },
      ],
    },
    {
      heading: "Cookies y almacenamiento local",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne no utiliza ",
            { b: "ninguna cookie de seguimiento" },
            ". El navegador almacena localmente:",
          ],
        },
        {
          kind: "ul",
          items: [
            [
              "Tu apodo y tus preferencias de idioma (para recuperarlos en tu próxima visita).",
            ],
            ["El fingerprint de tu dispositivo (para las cuotas)."],
            ["Tu preferencia de tema (claro/oscuro)."],
          ],
        },
        {
          kind: "p",
          content: [
            "Puedes borrarlo todo vaciando el almacenamiento local de tu navegador para este sitio.",
          ],
        },
      ],
    },
  ],
};

const de: LegalDoc = {
  title: "Impressum",
  updated: "Zuletzt aktualisiert: 14. Mai 2026",
  sections: [
    {
      heading: "Anbieter",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne ist ein anonymer Chat-Dienst, betrieben von Ralys, einer Privatperson mit Wohnsitz in Frankreich. Kontakt: ",
            email,
            ".",
          ],
        },
        {
          kind: "pMuted",
          content: [
            "Hosting: OVH SAS, 2 rue Kellermann, 59100 Roubaix, Frankreich.",
          ],
        },
      ],
    },
    {
      heading: "Nutzungsbedingungen",
      blocks: [
        {
          kind: "ul",
          items: [
            [
              "Der Dienst ist Personen ab ",
              { b: "16 Jahren" },
              " vorbehalten. Der Zugang setzt die ausdrückliche Zustimmung zu dieser Altersbedingung vor jeder Sitzung voraus.",
            ],
            [
              "Strengstens untersagt sind: hetzerische oder diskriminierende Äußerungen, Drohungen, Belästigung, sexuell explizite Inhalte, das Weitergeben personenbezogener Daten anderer (Doxing), Spam sowie jede Aufstachelung zu Gewalt.",
            ],
            [
              "Jede Meldung löst eine menschliche Prüfung aus und kann zu einer vorübergehenden oder dauerhaften Sperrung des Kontos bzw. des Geräts führen. Dauerhafte Sperren werden erst nach Prüfung durch einen menschlichen Moderator verhängt.",
            ],
            [
              "Die Nutzer verpflichten sich, die in ihrem Wohnsitzland geltenden Gesetze einzuhalten.",
            ],
          ],
        },
      ],
    },
    {
      heading: "Personenbezogene Daten (DSGVO)",
      blocks: [
        {
          kind: "p",
          content: ["Jolyne minimiert die Datenerhebung so weit wie möglich. Konkret:"],
        },
        {
          kind: "ul",
          items: [
            [
              { b: "Der Inhalt der Nachrichten wird niemals gespeichert oder protokolliert." },
              " Er fließt nur zwischen den beiden Teilnehmern für die Dauer des Gesprächs.",
            ],
            [
              "Eine Gerätekennung (Fingerprint) wird clientseitig berechnet und dient dazu, die kostenlosen Kontingente durchzusetzen und die Umgehung von Sperren zu verhindern. Sie wird serverseitig niemals mit einem Namen oder einer E-Mail verknüpft.",
            ],
            [
              "Die IP-Adresse wird vor jeder Speicherung auf Anwendungsebene gehasht. Server-Logs enthalten nur technische Metadaten (Sitzungsdauer, Sprachpaar, Rückgabecode).",
            ],
            [
              "Im Falle einer Meldung werden die letzten N erfassten Nachrichten im Ruhezustand verschlüsselt und nach 90 Tagen automatisch gelöscht.",
            ],
            [
              { b: "KI-Lehrkraft-Bot:" },
              " Steht nach 10 Sekunden kein menschlicher Partner zur Verfügung, übernimmt ein KI-Lehrkraft-Bot (Abzeichen « 🤖 KI-Lehrkraft » im Chat), damit du weiter üben kannst. Der Inhalt der mit diesem Bot ausgetauschten Nachrichten wird in Echtzeit an Anthropic (Hersteller des Claude-Modells) übermittelt, um dessen Antworten zu erzeugen. Diesen Aufrufen wird keine Nutzerkennung beigefügt, und Anthropic bewahrt diese Austausche nicht auf, um seine Modelle zu trainieren (übliche kommerzielle Richtlinie). Wenn du nicht möchtest, dass deine Nachrichten von Anthropic verarbeitet werden, setze das Gespräch nach dem Erscheinen des Abzeichens nicht fort — tippe auf « Weiter », um es erneut mit einem menschlichen Match zu versuchen.",
            ],
            [
              { b: "Premium-Abo:" },
              " Die Zahlung wird von Stripe (Stripe Payments Europe) abgewickelt. Jolyne sieht oder speichert deine Bankdaten niemals — es werden nur eine Stripe-Kundenkennung, der Status deines Abos und dessen Enddatum gespeichert, um die Premium-Funktionen freizuschalten. Du kannst dein Abo jederzeit in deinem Konto verwalten oder kündigen.",
            ],
          ],
        },
        {
          kind: "p",
          content: [
            { b: "Recht auf Löschung:" },
            " Du kannst die Löschung aller dich betreffenden Daten verlangen, indem du an die obige Kontaktadresse schreibst. Antwort innerhalb von 30 Tagen.",
          ],
        },
      ],
    },
    {
      heading: "Moderation und Digital Services Act",
      blocks: [
        {
          kind: "p",
          content: [
            "Kontaktstelle für Meldungen illegaler Inhalte, Auskunftsersuchen von Behörden oder jede Frage zur Moderation:",
          ],
        },
        { kind: "p", content: [email] },
        {
          kind: "pMuted",
          content: [
            "Gemäß der Verordnung (EU) 2022/2065 über digitale Dienste (DSA) bearbeitet Jolyne glaubhafte Meldungen innerhalb einer angemessenen Frist. Du kannst gegen eine Sperre Widerspruch einlegen, indem du auf die Benachrichtigungs-E-Mail antwortest.",
          ],
        },
      ],
    },
    {
      heading: "Cookies und lokaler Speicher",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne verwendet ",
            { b: "keine Tracking-Cookies" },
            ". Der Browser speichert lokal:",
          ],
        },
        {
          kind: "ul",
          items: [
            [
              "Deinen Spitznamen und deine Sprachpräferenzen (damit sie bei deinem nächsten Besuch wieder da sind).",
            ],
            ["Den Fingerprint deines Geräts (für die Kontingente)."],
            ["Deine Themenpräferenz (hell/dunkel)."],
          ],
        },
        {
          kind: "p",
          content: [
            "Du kannst alles löschen, indem du den lokalen Speicher deines Browsers für diese Website leerst.",
          ],
        },
      ],
    },
  ],
};

export const LEGAL_DOCS: Record<UILang, LegalDoc> = { fr, en, es, de };
