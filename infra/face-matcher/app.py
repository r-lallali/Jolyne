import os
import logging
from io import BytesIO
import flask
import requests
import face_recognition
from PIL import Image, ImageOps
import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("face-matcher")

app = flask.Flask(__name__)

# Seuil de distance euclidienne : 0.6 est le seuil standard de face_recognition (dlib).
# Plus la distance est faible, plus la ressemblance est forte.
# Distance <= 0.6 = Correspondance (Match).
SIMILARITY_THRESHOLD = 0.6

def download_image(url):
    try:
        logger.info(f"Téléchargement de l'image : {url}")
        resp = requests.get(url, timeout=5)
        resp.raise_for_status()
        return BytesIO(resp.content)
    except Exception as e:
        logger.error(f"Échec du téléchargement de l'image ({url}) : {e}")
        raise ValueError(f"Impossible de télécharger l'image : {e}")

def load_image(file_obj):
    img = Image.open(file_obj)
    img = ImageOps.exif_transpose(img)
    return np.array(img.convert("RGB"))

def get_face_encodings(image, is_profile=False):
    # Try 1: HOG avec upsampling par défaut (1)
    locations = face_recognition.face_locations(image, number_of_times_to_upsample=1, model="hog")
    
    # Try 2: HOG avec upsampling de 2 (pour les visages plus petits, flous ou éloignés)
    if not locations:
        logger.info(f"Tentative de détection (HOG upsample=2) pour {'la photo de profil' if is_profile else 'le selfie'}...")
        locations = face_recognition.face_locations(image, number_of_times_to_upsample=2, model="hog")
        
    # Try 3: Modèle CNN (très précis, résistant aux angles et à la luminosité)
    if not locations:
        logger.info(f"Tentative de détection (modèle CNN) pour {'la photo de profil' if is_profile else 'le selfie'}...")
        try:
            locations = face_recognition.face_locations(image, number_of_times_to_upsample=1, model="cnn")
        except Exception as cnn_err:
            logger.warning(f"Impossible d'utiliser le modèle CNN (dlib CUDA non disponible) : {cnn_err}")
            
    if not locations:
        return []
        
    return face_recognition.face_encodings(image, known_face_locations=locations)

@app.route('/compare', methods=['POST'])
def compare_faces():
    data = flask.request.get_json()
    if not data:
        return flask.jsonify({"error": "JSON payload requis"}), 400

    profile_url = data.get("profile_photo_url")
    live_url = data.get("live_photo_url")

    if not profile_url or not live_url:
        return flask.jsonify({"error": "profile_photo_url et live_photo_url requis"}), 400

    try:
        # 1. Télécharger les images
        profile_file = download_image(profile_url)
        live_file = download_image(live_url)

        # 2. Charger les images et corriger l'orientation EXIF
        profile_image = load_image(profile_file)
        live_image = load_image(live_file)

        # 3. Extraire les encodages faciaux avec stratégie multi-passes (HOG + upsample + CNN)
        profile_encodings = get_face_encodings(profile_image, is_profile=True)
        live_encodings = get_face_encodings(live_image, is_profile=False)

        # 4. Valider la présence de visages
        if not profile_encodings:
            logger.warn("Aucun visage détecté sur la photo de profil")
            return flask.jsonify({
                "matched": False,
                "confidence": 0.0,
                "error": "Aucun visage détecté sur la photo de profil."
            }), 200

        if not live_encodings:
            logger.warn("Aucun visage détecté sur la photo en direct (selfie)")
            return flask.jsonify({
                "matched": False,
                "confidence": 0.0,
                "error": "Aucun visage détecté sur le selfie. Veuillez bien faire face à la caméra."
            }), 200

        # Si plusieurs visages sont détectés sur le selfie live, on rejette par sécurité
        if len(live_encodings) > 1:
            logger.warn(f"Plusieurs visages ({len(live_encodings)}) détectés sur le selfie live")
            return flask.jsonify({
                "matched": False,
                "confidence": 0.0,
                "error": "Plusieurs visages détectés sur le selfie. Veuillez être seul sur l'image."
            }), 200

        # 5. Calculer la distance et vérifier la correspondance
        # On compare le premier visage de chaque image
        face_dist = face_recognition.face_distance([profile_encodings[0]], live_encodings[0])[0]
        matched = bool(face_dist <= SIMILARITY_THRESHOLD)

        # Conversion de la distance en un score de confiance/similarité (0..1)
        # Une distance de 0.0 = 100% de similarité. Une distance >= 1.0 = 0% de similarité.
        confidence = float(max(0.0, min(1.0, 1.0 - face_dist)))

        logger.info(f"Comparaison terminée - matched: {matched}, distance: {face_dist:.4f}, confidence: {confidence:.4f}")

        return flask.jsonify({
            "matched": matched,
            "confidence": confidence,
            "distance": float(face_dist)
        }), 200

    except ValueError as val_err:
        return flask.jsonify({"error": str(val_err)}), 400
    except Exception as e:
        logger.error(f"Erreur interne lors de la comparaison faciale : {e}", exc_info=True)
        return flask.jsonify({"error": f"Erreur interne lors du traitement de l'image : {e}"}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5001))
    logger.info(f"Démarrage du service face-matcher sur le port {port}")
    app.run(host="0.0.0.0", port=port)
