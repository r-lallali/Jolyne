-- Manquait à la Phase 2 initiale : pour bannir l'IP du reporté on a besoin
-- de son hash IP dans la table reports. Default '' pour ne pas casser les
-- rows existantes (créées avant cette migration).
ALTER TABLE reports
  ADD COLUMN reported_ip_hash TEXT NOT NULL DEFAULT '';
