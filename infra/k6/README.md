# Tests de charge k6

## Installer k6

```bash
brew install k6   # macOS
# ou via Docker (sans installation)
```

## Lancer en local (dev compose)

```bash
# Dans un terminal : démarrer le backend dev
cd infra && docker compose -f docker-compose.dev.yml up -d

# Dans un autre :
k6 run -e JOLYNE_WS=ws://localhost:8080 infra/k6/match-load.js
```

## Lancer contre la prod

```bash
k6 run -e JOLYNE_WS=wss://api.jolyne.ralys.ovh infra/k6/match-load.js
```

## Ce que ça mesure

Le scénario fait monter 100 VUs sur 10s, maintient 30s, puis descend. Chaque
VU se connecte, attend le match, envoie 3 messages, ferme. Les métriques
exportées :

- `matched_count` : combien de VUs ont réussi à matcher (cible : > 50)
- `time_to_match` p95 (cible : < 3s)
- `queue_timeouts` : combien ont attendu 30s sans peer (devrait être ~0)

Les seuils sont posés dans le script, k6 exit non-zero si dépassés.

## À adapter

- Pour un test plus lourd, monter `target` à 500-1000 dans les stages.
- Pour stresser le matching plutôt que la connexion, augmenter `duration`
  et ajouter une boucle de "Next" dans le handler `matched`.
