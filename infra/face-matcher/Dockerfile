FROM python:3.10-slim-bullseye

RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg62-turbo \
    libpng16-16 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Warnings pip non actionnables dans une image jetable : on tourne en root par
# design (pas de venv) et la version de pip est figée par l'image de base.
ENV PIP_ROOT_USER_ACTION=ignore \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY requirements.txt .
# face-recognition est installé en --no-deps pour empêcher pip de tirer le
# paquet `dlib` source qui nécessiterait cmake + g++ (toolchain absente de
# l'image slim) — le module `dlib` est fourni par le wheel prebuilt dlib-bin.
# Ordre critique : le --no-deps passe en DERNIER. Toute install ultérieure
# ferait une résolution complète, verrait `dlib>=19.7` déclaré par
# face-recognition mais non installé (dlib-bin porte un autre nom de paquet)
# et logguerait une ERROR de résolveur à chaque build — cosmétique mais
# alarmante dans les logs de déploiement. face-recognition-models est tiré
# via requirements.txt.
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir dlib-bin==19.24.6 \
    && pip install --no-cache-dir --no-deps face-recognition==1.3.0

COPY app.py .

EXPOSE 5001

ENV PORT=5001

CMD ["python", "app.py"]
