FROM python:3.10-slim-bullseye

RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg62-turbo \
    libpng16-16 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
# Ordre critique : on installe d'abord dlib-bin (wheel prebuilt — pas de
# compilation requise), puis face-recognition avec --no-deps pour empêcher
# pip de retomber sur le paquet `dlib` source qui nécessiterait cmake +
# g++ (toolchain absente de l'image slim). face-recognition-models est
# tiré séparément via requirements.txt.
RUN pip install --no-cache-dir dlib-bin==19.24.6 \
    && pip install --no-cache-dir --no-deps face-recognition==1.3.0 \
    && pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 5001

ENV PORT=5001

CMD ["python", "app.py"]
