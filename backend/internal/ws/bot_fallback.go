package ws

// Réponses de repli quand Claude est injoignable (timeout, 5xx, clé
// révoquée…). Le bot reste poli, indique brièvement que ça ne marche
// pas, puis termine la conversation pour laisser le user re-queue.

var botFallbacks = map[string]string{
	"fr": "Désolée, j'ai un petit bug — on se reparle plus tard !",
	"en": "Sorry, I'm having a glitch — let's talk again later!",
	"es": "Perdona, tengo un fallo — ¡hablamos más tarde!",
	"de": "Entschuldige, ich habe einen kleinen Fehler — wir reden später!",
}

var botGoodbye = map[string]string{
	"fr": "Il faut que je file, mais c'était sympa ! À très vite 👋",
	"en": "Gotta run, but this was fun! See you soon 👋",
	"es": "Tengo que irme, ¡pero ha sido genial! Hasta pronto 👋",
	"de": "Ich muss los, aber das war schön! Bis bald 👋",
}

func fallbackReply(lang string) string {
	if s, ok := botFallbacks[lang]; ok {
		return s
	}
	return botFallbacks["en"]
}

func goodbyeMsg(lang string) string {
	if s, ok := botGoodbye[lang]; ok {
		return s
	}
	return botGoodbye["en"]
}
