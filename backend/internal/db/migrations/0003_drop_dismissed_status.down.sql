-- Restaure la CHECK contraint qui acceptait 'dismissed'. On NE PEUT PAS
-- recréer les anciennes lignes 'dismissed' (fusionnées dans 'resolved'
-- au up), l'opération est lossy.
ALTER TABLE reports DROP CONSTRAINT reports_status_chk;
ALTER TABLE reports ADD CONSTRAINT reports_status_chk
  CHECK (status IN ('open','resolved','dismissed'));
