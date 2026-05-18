-- On supprime la catégorie "dismissed" : "resolved" suffit (un signalement
-- non actionnable est tout autant clos qu'un signalement légitime traité).
-- Les anciennes lignes 'dismissed' sont fusionnées dans 'resolved'.
-- L'audit_log conserve les actions 'report_dismissed' historiques telles
-- quelles — c'est l'historique des décisions, on n'y touche pas.

UPDATE reports SET status = 'resolved' WHERE status = 'dismissed';

ALTER TABLE reports DROP CONSTRAINT reports_status_chk;
ALTER TABLE reports ADD CONSTRAINT reports_status_chk
  CHECK (status IN ('open','resolved'));
