-- Révocation des sessions : les cookies de session sont des HMAC stateless
-- valables 30 jours. Sans version, un reset de mot de passe (scénario
-- compromission) ne coupait pas les sessions déjà ouvertes — un cookie volé
-- restait valable un mois. On ajoute un compteur bumpé au reset (et à un futur
-- « déconnecter partout ») : la version est signée dans le cookie et confrontée
-- à cette colonne à chaque requête authentifiée. Un mismatch = session révoquée.

ALTER TABLE users ADD COLUMN session_version BIGINT NOT NULL DEFAULT 0;
