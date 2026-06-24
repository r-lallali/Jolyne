-- Mode Cours, module « Écriture » : apprentissage du système d'écriture pour
-- les langues à script non latin (ja/ko/ar/zh). Une leçon porte désormais un
-- `kind` : 'vocab' (défaut, leçon de vocabulaire existante) ou 'script' (leçon
-- d'écriture — signes, sons, formes, composition, tracé). Le front dérive des
-- exercices différents selon le kind. Les items script vivent dans le même
-- JSONB `content` avec des champs additionnels (sound, forms, parts, strokes,
-- example) ignorés par les leçons de vocabulaire.
ALTER TABLE learn_lessons
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'vocab';
