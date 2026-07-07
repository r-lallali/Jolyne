package ws

import "strings"

// Scénarios de jeu de rôle du prof IA : au lieu du chat libre, l'apprenant
// choisit une mission (commander au restaurant, entretien d'embauche…) que le
// prof met en scène dans la langue cible. Le catalogue est la source de
// vérité côté serveur : validation du paramètre WS `scenario`, gating
// premium, et bloc de prompt ajouté au system de la persona.
//
// Fin de mission : le prompt demande à Claude de terminer SON message de
// félicitations par le marqueur exact [MISSION_OK]. Le serveur le strip de la
// réponse et publie un évènement mission dans la room (relayé au client en
// frame `mission_complete`).

const missionMarker = "[MISSION_OK]"

type botScenario struct {
	ID   string
	Free bool // accessible sans Premium (2 scénarios d'appel)
	// Block : bloc ajouté au system prompt de la persona. Rédigé en français
	// (langue de consigne des prompts internes) — la langue de JEU reste
	// imposée par la persona.
	Block string
}

// scenarioBlock : consignes communes + mission spécifique.
func scenarioPrompt(role, learnerRole, mission string) string {
	return `

Mode jeu de rôle :
- Tu joues le rôle suivant : ` + role + `. L'apprenant joue : ` + learnerRole + `. Reste dans la scène tout du long, toujours dans ta langue d'enseignement.
- Mission de l'apprenant : ` + mission + `.
- Ouvre la scène toi-même : plante le décor en une ou deux phrases dans ton tout premier message, puis laisse l'apprenant agir.
- Continue de corriger ses erreurs en reformulant naturellement, comme d'habitude.
- S'il s'éloigne du scénario, ramène-le gentiment dans la scène.
- Quand la mission est clairement accomplie, félicite l'apprenant en une phrase et termine ce message précis par le marqueur exact ` + missionMarker + ` (une seule fois dans toute la conversation, jamais avant).`
}

var botScenarios = map[string]botScenario{
	"restaurant": {
		ID: "restaurant", Free: true,
		Block: scenarioPrompt(
			"serveur/serveuse d'un restaurant local animé",
			"un client qui vient dîner",
			"demander une table, poser au moins une question sur le menu, commander un plat et une boisson, puis demander l'addition",
		),
	},
	"directions": {
		ID: "directions", Free: true,
		Block: scenarioPrompt(
			"un passant sympathique dans une grande ville",
			"un touriste un peu perdu",
			"aborder poliment le passant, expliquer où il veut aller (gare, musée ou hôtel), comprendre l'itinéraire et le reformuler pour confirmer",
		),
	},
	"interview": {
		ID: "interview", Free: false,
		Block: scenarioPrompt(
			"recruteur/recruteuse bienveillant(e) mais exigeant(e)",
			"un candidat à un entretien d'embauche pour le poste de son choix",
			"se présenter, décrire son expérience et ses qualités, répondre à au moins deux questions du recruteur et poser une question sur le poste",
		),
	},
	"market": {
		ID: "market", Free: false,
		Block: scenarioPrompt(
			"marchand(e) de fruits et légumes sur un marché de rue, qui aime négocier",
			"un client qui fait ses courses",
			"demander les prix, négocier une réduction sur au moins un article et conclure l'achat",
		),
	},
	"doctor": {
		ID: "doctor", Free: false,
		Block: scenarioPrompt(
			"médecin généraliste calme et pédagogue",
			"un patient venu en consultation",
			"décrire ses symptômes (au choix), répondre aux questions du médecin et comprendre le conseil ou le traitement donné",
		),
	},
}

// scenarioByID : lookup + validation. ok=false si inconnu.
func scenarioByID(id string) (botScenario, bool) {
	s, ok := botScenarios[strings.ToLower(strings.TrimSpace(id))]
	return s, ok
}

// stripMissionMarker retire le marqueur de fin de mission d'une réponse.
// found=true si le marqueur était présent (mission accomplie).
func stripMissionMarker(reply string) (string, bool) {
	if !strings.Contains(reply, missionMarker) {
		return reply, false
	}
	return strings.TrimSpace(strings.ReplaceAll(reply, missionMarker, "")), true
}

// scenarioOpeningSeed : consigne du premier message quand un scénario est
// actif (remplace le greeting canned de la persona — l'ouverture doit planter
// le décor de la scène, elle est générée par Claude).
const scenarioOpeningSeed = "Ouvre la scène du jeu de rôle : plante le décor en une ou deux phrases dans ta langue d'enseignement, dans ton rôle, puis laisse-moi agir."
