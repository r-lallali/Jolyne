FROM python:3.10-slim-bullseye

# Installer les outils nécessaires pour la compilation de dlib
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    libjpeg-dev \
    libpng-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copier et installer les dépendances (pip install compilera dlib)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copier le code applicatif
COPY app.py .

EXPOSE 5001

ENV PORT=5001

CMD ["python", "app.py"]
