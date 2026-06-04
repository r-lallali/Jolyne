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

const pt: LegalDoc = {
  title: "Aviso legal",
  updated: "Última atualização: 14 de maio de 2026",
  sections: [
    {
      heading: "Responsável pela publicação",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne é um serviço de chat anónimo operado por Ralys, um particular residente em França. Contacto: ",
            email,
            ".",
          ],
        },
        {
          kind: "pMuted",
          content: [
            "Alojamento: OVH SAS, 2 rue Kellermann, 59100 Roubaix, França.",
          ],
        },
      ],
    },
    {
      heading: "Condições de utilização",
      blocks: [
        {
          kind: "ul",
          items: [
            [
              "O serviço é reservado a pessoas com ",
              { b: "16 anos ou mais" },
              ". O acesso exige a aceitação explícita desta condição de idade antes de cada sessão.",
            ],
            [
              "São estritamente proibidos: comentários de ódio ou discriminatórios, ameaças, assédio, conteúdo sexualmente explícito, partilha de dados pessoais de terceiros (doxing), spam ou qualquer incitamento à violência.",
            ],
            [
              "Qualquer denúncia desencadeia uma análise humana e pode levar à suspensão temporária ou permanente da conta/dispositivo. As proibições permanentes só são aplicadas após análise por um moderador humano.",
            ],
            [
              "Os utilizadores comprometem-se a cumprir as leis em vigor no seu país de residência.",
            ],
          ],
        },
      ],
    },
    {
      heading: "Dados pessoais (RGPD)",
      blocks: [
        {
          kind: "p",
          content: ["A Jolyne minimiza ao máximo a recolha de dados. Em concreto:"],
        },
        {
          kind: "ul",
          items: [
            [
              { b: "O conteúdo das mensagens nunca é armazenado nem registado." },
              " Passa apenas entre os dois participantes durante a conversa.",
            ],
            [
              "Um identificador do dispositivo (fingerprint) é calculado do lado do cliente e usado para aplicar as quotas gratuitas e evitar a evasão de proibições. Nunca é associado a um nome ou email do lado do servidor.",
            ],
            [
              "O teu IP é convertido em hash antes de qualquer armazenamento ao nível da aplicação. Os registos do servidor contêm apenas metadados técnicos (duração da sessão, par de línguas, código de retorno).",
            ],
            [
              "Em caso de denúncia, as últimas N mensagens captadas são cifradas em repouso e eliminadas automaticamente após 90 dias.",
            ],
            [
              { b: "Tutor IA:" },
              " se não houver nenhum parceiro humano disponível após 10 segundos, um tutor IA (badge « 🤖 Tutor IA » exibido no chat) assume para que possas continuar a praticar. O conteúdo das mensagens trocadas com este bot é enviado em tempo real à Anthropic (criadora do modelo Claude) para gerar as respostas. Nenhum identificador de utilizador é associado a estas chamadas e a Anthropic não conserva estas trocas para treinar os seus modelos (política comercial padrão). Se não quiseres que as tuas mensagens sejam processadas pela Anthropic, não continues a conversa depois de o badge aparecer — toca em « Seguinte » para tentar de novo um match humano.",
            ],
            [
              { b: "Subscrição Premium:" },
              " o pagamento é processado pela Stripe (Stripe Payments Europe). A Jolyne nunca vê nem armazena os teus dados bancários — apenas um ID de cliente Stripe, o estado da tua subscrição e a respetiva data de fim são guardados para desbloquear as funcionalidades Premium. Podes gerir ou cancelar a tua subscrição a qualquer momento na tua conta.",
            ],
          ],
        },
        {
          kind: "p",
          content: [
            { b: "Direito ao apagamento:" },
            " podes solicitar a eliminação de quaisquer dados que te digam respeito escrevendo para o endereço de contacto acima. Resposta no prazo de 30 dias.",
          ],
        },
      ],
    },
    {
      heading: "Moderação e Regulamento dos Serviços Digitais",
      blocks: [
        {
          kind: "p",
          content: [
            "Ponto de contacto para denúncias de conteúdo ilegal, pedidos de informação das autoridades ou qualquer questão relativa à moderação:",
          ],
        },
        { kind: "p", content: [email] },
        {
          kind: "pMuted",
          content: [
            "Em conformidade com o Regulamento (UE) 2022/2065 relativo aos serviços digitais (DSA), a Jolyne trata as denúncias credíveis num prazo razoável. Podes contestar uma proibição respondendo ao email de notificação.",
          ],
        },
      ],
    },
    {
      heading: "Cookies e armazenamento local",
      blocks: [
        {
          kind: "p",
          content: [
            "A Jolyne não usa ",
            { b: "nenhum cookie de rastreamento" },
            ". O teu navegador guarda localmente:",
          ],
        },
        {
          kind: "ul",
          items: [
            [
              "O teu nome e preferências de língua (para serem recordados na próxima visita).",
            ],
            ["O fingerprint do teu dispositivo (para as quotas)."],
            ["A tua preferência de tema (claro/escuro)."],
          ],
        },
        {
          kind: "p",
          content: [
            "Podes apagar tudo limpando o armazenamento local do teu navegador para este site.",
          ],
        },
      ],
    },
  ],
};

const it: LegalDoc = {
  title: "Note legali",
  updated: "Ultimo aggiornamento: 14 maggio 2026",
  sections: [
    {
      heading: "Titolare",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne è un servizio di chat anonima gestito da Ralys, un privato con sede in Francia. Contatto: ",
            email,
            ".",
          ],
        },
        {
          kind: "pMuted",
          content: [
            "Hosting: OVH SAS, 2 rue Kellermann, 59100 Roubaix, Francia.",
          ],
        },
      ],
    },
    {
      heading: "Condizioni d'uso",
      blocks: [
        {
          kind: "ul",
          items: [
            [
              "Il servizio è riservato alle persone di ",
              { b: "16 anni o più" },
              ". L'accesso richiede l'accettazione esplicita di questa condizione di età prima di ogni sessione.",
            ],
            [
              "Sono severamente vietati: commenti d'odio o discriminatori, minacce, molestie, contenuti sessualmente espliciti, condivisione di dati personali altrui (doxing), spam o qualsiasi incitamento alla violenza.",
            ],
            [
              "Ogni segnalazione attiva una verifica umana e può portare alla sospensione temporanea o permanente dell'account/dispositivo. I ban permanenti vengono applicati solo dopo la verifica di un moderatore umano.",
            ],
            [
              "Gli utenti si impegnano a rispettare le leggi in vigore nel proprio paese di residenza.",
            ],
          ],
        },
      ],
    },
    {
      heading: "Dati personali (GDPR)",
      blocks: [
        {
          kind: "p",
          content: ["Jolyne riduce al minimo la raccolta dei dati. In particolare:"],
        },
        {
          kind: "ul",
          items: [
            [
              { b: "Il contenuto dei messaggi non viene mai memorizzato né registrato." },
              " Transita solo tra i due partecipanti per la durata della conversazione.",
            ],
            [
              "Un identificatore del dispositivo (fingerprint) viene calcolato lato client e usato per applicare le quote gratuite ed evitare l'elusione dei ban. Non viene mai collegato a un nome o a un'email lato server.",
            ],
            [
              "Il tuo IP viene sottoposto a hash prima di qualsiasi memorizzazione a livello applicativo. I log del server contengono solo metadati tecnici (durata della sessione, coppia di lingue, codice di ritorno).",
            ],
            [
              "In caso di segnalazione, gli ultimi N messaggi acquisiti vengono cifrati a riposo ed eliminati automaticamente dopo 90 giorni.",
            ],
            [
              { b: "Tutor IA:" },
              " se nessun partner umano è disponibile dopo 10 secondi, un tutor IA (badge « 🤖 Tutor IA » mostrato nella chat) subentra così puoi continuare a esercitarti. Il contenuto dei messaggi scambiati con questo bot viene inviato in tempo reale ad Anthropic (creatrice del modello Claude) per generare le risposte. Nessun identificatore utente è associato a queste chiamate e Anthropic non conserva questi scambi per addestrare i propri modelli (policy commerciale standard). Se non vuoi che i tuoi messaggi siano elaborati da Anthropic, non proseguire la conversazione dopo la comparsa del badge — tocca « Avanti » per ritentare un match umano.",
            ],
            [
              { b: "Abbonamento Premium:" },
              " il pagamento è gestito da Stripe (Stripe Payments Europe). Jolyne non vede né memorizza mai i tuoi dati bancari — vengono conservati solo un ID cliente Stripe, lo stato del tuo abbonamento e la sua data di fine per sbloccare le funzionalità Premium. Puoi gestire o annullare l'abbonamento in qualsiasi momento dal tuo account.",
            ],
          ],
        },
        {
          kind: "p",
          content: [
            { b: "Diritto alla cancellazione:" },
            " puoi richiedere la cancellazione di qualsiasi dato che ti riguarda scrivendo all'indirizzo di contatto sopra. Risposta entro 30 giorni.",
          ],
        },
      ],
    },
    {
      heading: "Moderazione e Digital Services Act",
      blocks: [
        {
          kind: "p",
          content: [
            "Punto di contatto per le segnalazioni di contenuti illegali, le richieste di informazioni delle autorità o qualsiasi domanda relativa alla moderazione:",
          ],
        },
        { kind: "p", content: [email] },
        {
          kind: "pMuted",
          content: [
            "In conformità al Regolamento (UE) 2022/2065 sui servizi digitali (DSA), Jolyne tratta le segnalazioni credibili entro un termine ragionevole. Puoi contestare un ban rispondendo all'email di notifica.",
          ],
        },
      ],
    },
    {
      heading: "Cookie e archiviazione locale",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne non usa ",
            { b: "alcun cookie di tracciamento" },
            ". Il tuo browser memorizza localmente:",
          ],
        },
        {
          kind: "ul",
          items: [
            [
              "Il tuo nickname e le preferenze di lingua (per ricordarli alla prossima visita).",
            ],
            ["Il fingerprint del tuo dispositivo (per le quote)."],
            ["La tua preferenza di tema (chiaro/scuro)."],
          ],
        },
        {
          kind: "p",
          content: [
            "Puoi cancellare tutto svuotando l'archiviazione locale del browser per questo sito.",
          ],
        },
      ],
    },
  ],
};

const zh: LegalDoc = {
  title: "法律声明",
  updated: "最后更新：2026 年 5 月 14 日",
  sections: [
    {
      heading: "运营方",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne 是由 Ralys 运营的匿名聊天服务，运营者为常驻法国的个人。联系方式：",
            email,
            "。",
          ],
        },
        {
          kind: "pMuted",
          content: [
            "托管商：OVH SAS，地址 2 rue Kellermann, 59100 Roubaix, France。",
          ],
        },
      ],
    },
    {
      heading: "使用条款",
      blocks: [
        {
          kind: "ul",
          items: [
            [
              "本服务仅面向 ",
              { b: "16 岁及以上" },
              " 的用户。每次会话前必须明确接受此年龄条件方可使用。",
            ],
            [
              "严禁以下行为：仇恨或歧视性言论、威胁、骚扰、露骨色情内容、泄露他人个人信息（人肉搜索）、垃圾信息，或任何煽动暴力的行为。",
            ],
            [
              "任何举报都会触发人工审核，并可能导致账号/设备被临时或永久停用。永久封禁仅在人工审核员审查后执行。",
            ],
            [
              "用户承诺遵守其居住国现行法律。",
            ],
          ],
        },
      ],
    },
    {
      heading: "个人数据（GDPR）",
      blocks: [
        {
          kind: "p",
          content: ["Jolyne 尽可能减少数据收集。具体而言："],
        },
        {
          kind: "ul",
          items: [
            [
              { b: "消息内容从不被存储或记录。" },
              " 它仅在两位参与者之间传递，仅持续于对话期间。",
            ],
            [
              "设备标识（指纹）在客户端计算，用于执行免费配额并防止规避封禁。在服务端从不与姓名或邮箱关联。",
            ],
            [
              "在任何应用层存储之前，你的 IP 都会先被哈希处理。服务器日志仅包含技术元数据（会话时长、语言组合、返回码）。",
            ],
            [
              "如遇举报，最近捕获的 N 条消息将被静态加密，并在 90 天后自动清除。",
            ],
            [
              { b: "AI 老师：" },
              " 如果 10 秒后仍无真人伙伴可用，AI 老师（聊天中显示「🤖 AI 老师」徽章）会接手，让你继续练习。与该机器人交换的消息内容会实时发送给 Anthropic（Claude 模型的开发者）以生成回复。这些调用不附带任何用户标识，且 Anthropic 不会保留这些对话用于训练其模型（标准商业政策）。如果你不希望自己的消息被 Anthropic 处理，请在徽章出现后不要继续对话——点按「下一步」以重新尝试真人匹配。",
            ],
            [
              { b: "Premium 订阅：" },
              " 付款由 Stripe（Stripe Payments Europe）处理。Jolyne 从不查看或存储你的银行信息——仅保留一个 Stripe 客户 ID、你的订阅状态及其结束日期，用于解锁 Premium 功能。你可随时在账号中管理或取消订阅。",
            ],
          ],
        },
        {
          kind: "p",
          content: [
            { b: "删除权：" },
            " 你可以写信至上述联系地址，要求删除任何与你有关的数据。我们将在 30 天内回复。",
          ],
        },
      ],
    },
    {
      heading: "内容管理与《数字服务法》",
      blocks: [
        {
          kind: "p",
          content: [
            "举报非法内容、当局的信息请求，或任何与内容管理相关问题的联系点：",
          ],
        },
        { kind: "p", content: [email] },
        {
          kind: "pMuted",
          content: [
            "根据关于数字服务的（欧盟）2022/2065 号条例（DSA），Jolyne 会在合理时间内处理可信的举报。你可以通过回复通知邮件对封禁提出申诉。",
          ],
        },
      ],
    },
    {
      heading: "Cookie 与本地存储",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne ",
            { b: "不使用任何跟踪 Cookie" },
            "。你的浏览器会在本地存储：",
          ],
        },
        {
          kind: "ul",
          items: [
            [
              "你的昵称和语言偏好（以便下次访问时记住）。",
            ],
            ["你的设备指纹（用于配额）。"],
            ["你的主题偏好（浅色/深色）。"],
          ],
        },
        {
          kind: "p",
          content: [
            "你可以通过清除浏览器中本网站的本地存储来删除全部内容。",
          ],
        },
      ],
    },
  ],
};

const ja: LegalDoc = {
  title: "法的事項",
  updated: "最終更新：2026年5月14日",
  sections: [
    {
      heading: "運営者",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne は、フランスに拠点を置く個人 Ralys が運営する匿名チャットサービスです。連絡先：",
            email,
            "。",
          ],
        },
        {
          kind: "pMuted",
          content: [
            "ホスティング：OVH SAS、2 rue Kellermann, 59100 Roubaix, France。",
          ],
        },
      ],
    },
    {
      heading: "利用規約",
      blocks: [
        {
          kind: "ul",
          items: [
            [
              "本サービスは ",
              { b: "16歳以上" },
              " の方を対象としています。利用にあたっては、各セッションの前にこの年齢条件への明示的な同意が必要です。",
            ],
            [
              "次の行為は固く禁じられています：差別的または憎悪的な発言、脅迫、嫌がらせ、露骨な性的コンテンツ、他人の個人情報の共有（ドキシング）、スパム、暴力の扇動。",
            ],
            [
              "あらゆる報告は人による確認を発動し、アカウント／端末の一時的または恒久的な停止につながる場合があります。恒久的な利用停止は、人間のモデレーターによる確認の後にのみ行われます。",
            ],
            [
              "利用者は、居住国で施行されている法律を遵守することに同意します。",
            ],
          ],
        },
      ],
    },
    {
      heading: "個人データ（GDPR）",
      blocks: [
        {
          kind: "p",
          content: ["Jolyne はデータ収集を可能な限り最小限に抑えています。具体的には："],
        },
        {
          kind: "ul",
          items: [
            [
              { b: "メッセージの内容は決して保存もログ記録もされません。" },
              " 会話の間、2人の参加者の間でのみやり取りされます。",
            ],
            [
              "端末識別子（フィンガープリント）はクライアント側で計算され、無料枠の適用と利用停止の回避防止に用いられます。サーバー側で名前やメールアドレスと結び付けられることはありません。",
            ],
            [
              "あなたの IP は、アプリケーションレベルで保存される前にハッシュ化されます。サーバーログには技術的なメタデータ（セッション時間、言語ペア、リターンコード）のみが含まれます。",
            ],
            [
              "報告があった場合、直近に取得された N 件のメッセージは保存時に暗号化され、90日後に自動的に削除されます。",
            ],
            [
              { b: "AIチューター：" },
              " 10秒経っても人間の相手が見つからない場合、AIチューター（チャット内に「🤖 AIチューター」バッジを表示）が引き継ぎ、練習を続けられます。このボットとやり取りしたメッセージの内容は、返信を生成するためにリアルタイムで Anthropic（Claude モデルの開発元）に送信されます。これらの呼び出しに利用者の識別子は付与されず、Anthropic はこれらのやり取りをモデルの学習に保持しません（標準的な商用ポリシー）。メッセージを Anthropic に処理されたくない場合は、バッジが表示された後に会話を続けず、「次へ」をタップして再度ヒューマンマッチをお試しください。",
            ],
            [
              { b: "Premium サブスクリプション：" },
              " 決済は Stripe（Stripe Payments Europe）が処理します。Jolyne があなたの銀行情報を見たり保存したりすることは一切ありません——Premium 機能を解放するために、Stripe の顧客 ID、サブスクリプションの状態と終了日のみを保持します。サブスクリプションはアカウントからいつでも管理または解約できます。",
            ],
          ],
        },
        {
          kind: "p",
          content: [
            { b: "消去権：" },
            " 上記の連絡先に書面で連絡することで、あなたに関するあらゆるデータの削除を請求できます。30日以内に回答します。",
          ],
        },
      ],
    },
    {
      heading: "モデレーションとデジタルサービス法",
      blocks: [
        {
          kind: "p",
          content: [
            "違法コンテンツの報告、当局からの情報請求、モデレーションに関するご質問の窓口：",
          ],
        },
        { kind: "p", content: [email] },
        {
          kind: "pMuted",
          content: [
            "デジタルサービスに関する規則（EU）2022/2065（DSA）に従い、Jolyne は信頼できる報告を合理的な期間内に処理します。利用停止については、通知メールに返信することで異議を申し立てられます。",
          ],
        },
      ],
    },
    {
      heading: "Cookie とローカルストレージ",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne は ",
            { b: "トラッキング Cookie を一切使用しません" },
            "。お使いのブラウザは次の情報をローカルに保存します：",
          ],
        },
        {
          kind: "ul",
          items: [
            [
              "あなたのニックネームと言語の設定（次回の訪問時に記憶するため）。",
            ],
            ["あなたの端末フィンガープリント（利用枠のため）。"],
            ["あなたのテーマ設定（ライト／ダーク）。"],
          ],
        },
        {
          kind: "p",
          content: [
            "このサイトのブラウザのローカルストレージを消去すれば、すべて削除できます。",
          ],
        },
      ],
    },
  ],
};

const ko: LegalDoc = {
  title: "법적 고지",
  updated: "최종 업데이트: 2026년 5월 14일",
  sections: [
    {
      heading: "운영자",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne은 프랑스에 거주하는 개인 Ralys가 운영하는 익명 채팅 서비스입니다. 연락처: ",
            email,
            ".",
          ],
        },
        {
          kind: "pMuted",
          content: [
            "호스팅: OVH SAS, 2 rue Kellermann, 59100 Roubaix, France.",
          ],
        },
      ],
    },
    {
      heading: "이용 약관",
      blocks: [
        {
          kind: "ul",
          items: [
            [
              "이 서비스는 ",
              { b: "만 16세 이상" },
              "만 이용할 수 있습니다. 매 세션 전에 이 연령 조건에 명시적으로 동의해야 이용할 수 있습니다.",
            ],
            [
              "다음 행위는 엄격히 금지됩니다: 혐오 또는 차별 발언, 협박, 괴롭힘, 노골적인 성적 콘텐츠, 타인의 개인정보 공유(신상털기), 스팸, 또는 폭력 선동.",
            ],
            [
              "모든 신고는 사람의 검토를 거치며, 계정/기기의 일시적 또는 영구적 정지로 이어질 수 있습니다. 영구 차단은 사람 운영자의 검토 후에만 이루어집니다.",
            ],
            [
              "이용자는 거주 국가에서 시행 중인 법률을 준수할 것에 동의합니다.",
            ],
          ],
        },
      ],
    },
    {
      heading: "개인정보(GDPR)",
      blocks: [
        {
          kind: "p",
          content: ["Jolyne은 데이터 수집을 최대한 최소화합니다. 구체적으로:"],
        },
        {
          kind: "ul",
          items: [
            [
              { b: "메시지 내용은 절대 저장되거나 기록되지 않습니다." },
              " 대화가 진행되는 동안 두 참여자 사이에서만 전달됩니다.",
            ],
            [
              "기기 식별자(핑거프린트)는 클라이언트 측에서 계산되며, 무료 사용량 적용과 차단 우회 방지에 사용됩니다. 서버 측에서 이름이나 이메일과 연결되지 않습니다.",
            ],
            [
              "당신의 IP는 애플리케이션 수준에서 저장되기 전에 해시 처리됩니다. 서버 로그에는 기술적 메타데이터(세션 시간, 언어 쌍, 응답 코드)만 포함됩니다.",
            ],
            [
              "신고가 접수되면, 최근에 수집된 N개의 메시지는 저장 시 암호화되며 90일 후 자동으로 삭제됩니다.",
            ],
            [
              { b: "AI 튜터:" },
              " 10초가 지나도 사람 상대가 없으면, AI 튜터(채팅에 「🤖 AI 튜터」 배지 표시)가 이어받아 계속 연습할 수 있게 해줍니다. 이 봇과 주고받은 메시지 내용은 답변 생성을 위해 Anthropic(Claude 모델 제작사)에 실시간으로 전송됩니다. 이 호출에는 어떤 사용자 식별자도 포함되지 않으며, Anthropic은 이 대화를 자사 모델 학습에 보관하지 않습니다(표준 상업 정책). 당신의 메시지가 Anthropic에 의해 처리되는 것을 원하지 않는다면, 배지가 나타난 후 대화를 계속하지 말고 「다음」을 눌러 사람 매칭을 다시 시도하세요.",
            ],
            [
              { b: "프리미엄 구독:" },
              " 결제는 Stripe(Stripe Payments Europe)가 처리합니다. Jolyne은 당신의 금융 정보를 보거나 저장하지 않습니다 — 프리미엄 기능 잠금 해제를 위해 Stripe 고객 ID, 구독 상태와 종료일만 보관합니다. 구독은 계정에서 언제든지 관리하거나 해지할 수 있습니다.",
            ],
          ],
        },
        {
          kind: "p",
          content: [
            { b: "삭제권:" },
            " 위 연락처로 서면 요청하면 당신과 관련된 모든 데이터의 삭제를 요청할 수 있습니다. 30일 이내에 답변드립니다.",
          ],
        },
      ],
    },
    {
      heading: "콘텐츠 관리와 디지털 서비스법",
      blocks: [
        {
          kind: "p",
          content: [
            "불법 콘텐츠 신고, 당국의 정보 요청, 또는 콘텐츠 관리와 관련된 문의 창구:",
          ],
        },
        { kind: "p", content: [email] },
        {
          kind: "pMuted",
          content: [
            "디지털 서비스에 관한 규정(EU) 2022/2065(DSA)에 따라, Jolyne은 신뢰할 수 있는 신고를 합리적인 기간 내에 처리합니다. 차단에 대해서는 알림 이메일에 회신하여 이의를 제기할 수 있습니다.",
          ],
        },
      ],
    },
    {
      heading: "쿠키와 로컬 저장소",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne은 ",
            { b: "추적 쿠키를 전혀 사용하지 않습니다" },
            ". 당신의 브라우저는 다음을 로컬에 저장합니다:",
          ],
        },
        {
          kind: "ul",
          items: [
            [
              "당신의 닉네임과 언어 설정(다음 방문 시 기억하기 위해).",
            ],
            ["당신의 기기 핑거프린트(사용량을 위해)."],
            ["당신의 테마 설정(라이트/다크)."],
          ],
        },
        {
          kind: "p",
          content: [
            "이 사이트에 대한 브라우저의 로컬 저장소를 지우면 모두 삭제할 수 있습니다.",
          ],
        },
      ],
    },
  ],
};

const ar: LegalDoc = {
  title: "إشعار قانوني",
  updated: "آخر تحديث: 14 مايو 2026",
  sections: [
    {
      heading: "الناشر",
      blocks: [
        {
          kind: "p",
          content: [
            "Jolyne خدمة دردشة مجهولة يُشغّلها Ralys، فرد مقيم في فرنسا. التواصل: ",
            email,
            ".",
          ],
        },
        {
          kind: "pMuted",
          content: [
            "الاستضافة: OVH SAS، 2 rue Kellermann، 59100 Roubaix، فرنسا.",
          ],
        },
      ],
    },
    {
      heading: "شروط الاستخدام",
      blocks: [
        {
          kind: "ul",
          items: [
            [
              "الخدمة مخصّصة للأشخاص ",
              { b: "بعمر 16 عامًا أو أكثر" },
              ". يتطلّب الوصول الموافقة الصريحة على شرط العمر هذا قبل كل جلسة.",
            ],
            [
              "يُمنع منعًا باتًا: الخطاب التحريضي أو التمييزي، والتهديدات، والتحرّش، والمحتوى الجنسي الصريح، ومشاركة المعلومات الشخصية للآخرين (التشهير)، والرسائل المزعجة، أو أي تحريض على العنف.",
            ],
            [
              "يؤدي أي بلاغ إلى مراجعة بشرية وقد يفضي إلى تعليق مؤقت أو دائم للحساب/الجهاز. لا يُفرض الحظر الدائم إلا بعد مراجعة من مشرف بشري.",
            ],
            [
              "يلتزم المستخدمون بالامتثال للقوانين السارية في بلد إقامتهم.",
            ],
          ],
        },
      ],
    },
    {
      heading: "البيانات الشخصية (اللائحة العامة لحماية البيانات)",
      blocks: [
        {
          kind: "p",
          content: ["تقلّل Jolyne جمع البيانات إلى أدنى حد ممكن. وتحديدًا:"],
        },
        {
          kind: "ul",
          items: [
            [
              { b: "لا يُخزَّن محتوى الرسائل ولا يُسجَّل أبدًا." },
              " فهو يمرّ فقط بين المشاركَيْن طوال مدة المحادثة.",
            ],
            [
              "يُحتسب معرّف للجهاز (بصمة) على جهة العميل ويُستخدم لتطبيق الحصص المجانية ومنع التحايل على الحظر. ولا يُربط أبدًا باسم أو بريد إلكتروني على جهة الخادم.",
            ],
            [
              "يُجزَّأ عنوان IP الخاص بك (hash) قبل أي تخزين على مستوى التطبيق. ولا تحتوي سجلات الخادم إلا على بيانات وصفية تقنية (مدة الجلسة، الزوج اللغوي، رمز الإرجاع).",
            ],
            [
              "في حالة الإبلاغ، تُشفَّر آخر N رسالة مُلتقطة أثناء التخزين وتُحذف تلقائيًا بعد 90 يومًا.",
            ],
            [
              { b: "المدرّس الذكي:" },
              " إذا لم يتوفّر شريك بشري بعد 10 ثوانٍ، يتولّى مدرّس ذكاء اصطناعي (تظهر شارة « 🤖 مدرّس ذكاء اصطناعي » في الدردشة) المهمّة لتتمكّن من مواصلة التدرّب. يُرسَل محتوى الرسائل المتبادَلة مع هذا الروبوت في الوقت الفعلي إلى Anthropic (صانعة نموذج Claude) لتوليد ردوده. ولا يُرفق أي معرّف للمستخدم بهذه الطلبات، ولا تحتفظ Anthropic بهذه المحادثات لتدريب نماذجها (سياسة تجارية معيارية). إذا كنت لا تريد أن تعالج Anthropic رسائلك، فلا تتابع المحادثة بعد ظهور الشارة — انقر على « التالي » لإعادة محاولة المطابقة البشرية.",
            ],
            [
              { b: "اشتراك Premium:" },
              " تتولّى Stripe (Stripe Payments Europe) عملية الدفع. ولا ترى Jolyne بياناتك المصرفية أو تخزّنها أبدًا — إذ لا يُحتفظ إلا بمعرّف عميل لدى Stripe وحالة اشتراكك وتاريخ انتهائه لإتاحة ميزات Premium. يمكنك إدارة اشتراكك أو إلغاؤه في أي وقت من حسابك.",
            ],
          ],
        },
        {
          kind: "p",
          content: [
            { b: "الحق في المحو:" },
            " يمكنك طلب حذف أي بيانات تخصّك بمراسلة عنوان التواصل أعلاه. ويكون الرد خلال 30 يومًا.",
          ],
        },
      ],
    },
    {
      heading: "الإشراف وقانون الخدمات الرقمية",
      blocks: [
        {
          kind: "p",
          content: [
            "جهة التواصل للإبلاغ عن المحتوى غير القانوني، وطلبات المعلومات من السلطات، أو أي سؤال يتعلّق بالإشراف:",
          ],
        },
        { kind: "p", content: [email] },
        {
          kind: "pMuted",
          content: [
            "وفقًا للائحة (الاتحاد الأوروبي) 2022/2065 بشأن الخدمات الرقمية (DSA)، تعالج Jolyne البلاغات الموثوقة خلال مدة معقولة. يمكنك الاعتراض على الحظر بالرد على بريد الإشعار.",
          ],
        },
      ],
    },
    {
      heading: "ملفات تعريف الارتباط والتخزين المحلي",
      blocks: [
        {
          kind: "p",
          content: [
            "لا تستخدم Jolyne ",
            { b: "أي ملفات تعريف ارتباط للتتبّع" },
            ". يخزّن متصفّحك محليًا:",
          ],
        },
        {
          kind: "ul",
          items: [
            [
              "اسمك المستعار وتفضيلات اللغة (لتذكّرها في زيارتك التالية).",
            ],
            ["بصمة جهازك (من أجل الحصص)."],
            ["تفضيل السمة لديك (فاتح/داكن)."],
          ],
        },
        {
          kind: "p",
          content: [
            "يمكنك محو كل شيء بمسح التخزين المحلي لهذا الموقع في متصفّحك.",
          ],
        },
      ],
    },
  ],
};

export const LEGAL_DOCS: Record<UILang, LegalDoc> = {
  fr,
  en,
  es,
  de,
  pt,
  it,
  zh,
  ja,
  ko,
  ar,
};
