FROM python:3.11-slim-bullseye

WORKDIR /app

ENV PIP_ROOT_USER_ACTION=ignore \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# torch CPU d'abord (index dédié — le wheel CUDA par défaut pèse ~2 Go de
# plus pour rien sur un serveur sans GPU), puis le reste. L'ordre compte :
# si detoxify était installé avant, pip tirerait le torch CUDA. Version ≥ 2.4
# obligatoire : en deçà, transformers désactive PyTorch et le modèle ne
# charge pas (vu au déploiement).
COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

# Pré-téléchargement des poids du modèle DANS l'image : le conteneur démarre
# instantanément et sans accès réseau (le checkpoint multilingual pèse ~1 Go).
RUN python -c "from detoxify import Detoxify; Detoxify('multilingual')"

COPY app.py .

EXPOSE 5002

ENV PORT=5002

CMD ["python", "app.py"]
