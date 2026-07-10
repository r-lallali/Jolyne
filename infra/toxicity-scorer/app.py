import os
import logging
import threading
import flask
from detoxify import Detoxify

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("toxicity-scorer")

app = flask.Flask(__name__)

# Modèle supervisé multilingue (XLM-RoBERTa fine-tuné toxicité, ~280M de
# paramètres, CPU). Chargé une fois au boot — les poids sont pré-téléchargés
# dans l'image Docker, aucun accès réseau au démarrage.
# Règle d'or #1 : les messages scorés ne sont JAMAIS loggés.
logger.info("Chargement du modèle Detoxify multilingual…")
model = Detoxify("multilingual")
logger.info("Modèle chargé.")

# L'inférence PyTorch n'est pas garantie thread-safe sous le serveur Flask
# threadé — un verrou sérialise les prédictions (quelques ms par message,
# largement suffisant pour du chat).
predict_lock = threading.Lock()

# Borne d'entrée défensive : un message de chat fait < 2000 caractères, tout
# excédent est tronqué (le début suffit à scorer).
MAX_TEXT_LEN = 4000


@app.route("/healthz", methods=["GET"])
def healthz():
    return flask.jsonify({"ok": True}), 200


@app.route("/score", methods=["POST"])
def score():
    data = flask.request.get_json(silent=True)
    if not data or not isinstance(data.get("text"), str):
        return flask.jsonify({"error": "champ 'text' requis"}), 400

    text = data["text"][:MAX_TEXT_LEN]
    if not text.strip():
        return flask.jsonify({"score": 0.0}), 200

    try:
        with predict_lock:
            results = model.predict(text)
        # Score agrégé = max des têtes (toxicity, insult, threat, obscene,
        # identity_attack, sexual_explicit…) : la moindre tête haute doit
        # faire remonter le message vers le juge IA.
        max_score = max(float(v) for v in results.values())
        return flask.jsonify({"score": max_score}), 200
    except Exception:
        # Pas de contenu dans les logs — juste le fait que ça a échoué.
        logger.error("Échec du scoring", exc_info=True)
        return flask.jsonify({"error": "scoring failed"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5002))
    logger.info(f"Démarrage du service toxicity-scorer sur le port {port}")
    app.run(host="0.0.0.0", port=port)
