-- Langues natives des deux membres d'une amitié, figées à la création
-- (le matching étant réciproque, chaque côté connaît la langue de l'autre).
-- Sert d'indice de langue source au tap-to-translate du chat ami — sans ça
-- le front ne peut que deviner par script ou déléguer à la détection auto.
-- NULL = amitié créée via le flux pending (langues inconnues à ce moment-là).
ALTER TABLE friends
    ADD COLUMN lang_a TEXT,
    ADD COLUMN lang_b TEXT;
