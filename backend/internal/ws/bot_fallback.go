package ws

// Réponses de repli quand Claude est injoignable (timeout, 5xx, clé
// révoquée…). Le bot reste poli, indique brièvement que ça ne marche
// pas, puis termine la conversation pour laisser le user re-queue.
//
// Le greeting d'ouverture, lui, n'est PAS ici : il est porté par chaque
// persona (botPersona.Greeting) — toujours identique pour une langue donnée,
// envoyé sans appel Claude. Voir bot_persona.go.

var botFallbacks = map[string]string{
	"fr": "Désolée, j'ai un petit bug — on se reparle plus tard !",
	"en": "Sorry, I'm having a glitch — let's talk again later!",
	"es": "Perdona, tengo un fallo — ¡hablamos más tarde!",
	"de": "Entschuldige, ich habe einen kleinen Fehler — wir reden später!",
	"pt": "Desculpa, estou com uma falha — falamos mais tarde!",
	"it": "Scusa, ho un piccolo bug — ci risentiamo più tardi!",
	"zh": "抱歉，我出了点小故障——我们晚点再聊！",
	"ja": "ごめんなさい、ちょっと不具合が出ています——また後で話しましょう！",
	"ko": "미안해요, 잠깐 오류가 났어요 — 나중에 다시 얘기해요!",
	"ar": "آسفة، حدث خلل بسيط — نتحدّث لاحقًا!",
}

var botGoodbye = map[string]string{
	"fr": "Il faut que je file, mais c'était sympa ! À très vite 👋",
	"en": "Gotta run, but this was fun! See you soon 👋",
	"es": "Tengo que irme, ¡pero ha sido genial! Hasta pronto 👋",
	"de": "Ich muss los, aber das war schön! Bis bald 👋",
	"pt": "Tenho de ir, mas foi muito giro! Até já 👋",
	"it": "Devo scappare, ma è stato bello! A presto 👋",
	"zh": "我得走了，不过聊得很开心！回头见 👋",
	"ja": "もう行かなきゃ、でも楽しかった！またね 👋",
	"ko": "이제 가봐야 해요, 그래도 즐거웠어요! 또 봐요 👋",
	"ar": "عليّ الذهاب، لكنها كانت دردشة ممتعة! إلى اللقاء قريبًا 👋",
}

// Message d'adieu quand le quota quotidien de messages au prof IA est épuisé.
// Invite à passer Premium pour continuer sans limite.
var botDailyLimit = map[string]string{
	"fr": "On a bien papoté aujourd'hui ! Tu as atteint ta limite quotidienne de messages avec moi. Repasse demain, ou passe Premium pour discuter sans limite 💛",
	"en": "We've chatted a lot today! You've hit your daily message limit with me. Come back tomorrow, or go Premium to chat without limits 💛",
	"es": "¡Hemos hablado mucho hoy! Has alcanzado tu límite diario de mensajes conmigo. Vuelve mañana o hazte Premium para hablar sin límites 💛",
	"de": "Wir haben heute viel geplaudert! Du hast dein tägliches Nachrichtenlimit mit mir erreicht. Komm morgen wieder oder hol dir Premium für grenzenloses Chatten 💛",
	"pt": "Conversámos muito hoje! Atingiste o teu limite diário de mensagens comigo. Volta amanhã, ou passa a Premium para conversar sem limites 💛",
	"it": "Abbiamo chiacchierato molto oggi! Hai raggiunto il tuo limite giornaliero di messaggi con me. Torna domani, oppure passa a Premium per chattare senza limiti 💛",
	"zh": "今天我们聊了好多！你已达到今天和我聊天的消息上限。明天再来，或升级 Premium 畅聊无限制 💛",
	"ja": "今日はたくさん話しましたね！わたしとの1日のメッセージ上限に達しました。また明日来てください。または無制限で話せるPremiumへ 💛",
	"ko": "오늘 많이 얘기했네요! 저와의 하루 메시지 한도에 도달했어요. 내일 다시 오거나, 제한 없이 대화하려면 프리미엄으로 전환하세요 💛",
	"ar": "تحدّثنا كثيرًا اليوم! لقد بلغت حدّك اليومي من الرسائل معي. عُد غدًا، أو اشترك في Premium للدردشة بلا حدود 💛",
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

func botDailyLimitMsg(lang string) string {
	if s, ok := botDailyLimit[lang]; ok {
		return s
	}
	return botDailyLimit["en"]
}
