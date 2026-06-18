-- Mode Cours : programme d'apprentissage type Duolingo. Deux familles de
-- tables :
--   1. Le CONTENU (cours → unités → leçons), partagé par tous les users et
--      (re)généré par le générateur Claude / le seed embarqué. Versionné par
--      `slug` stable pour réécrire un cours sans casser les progrès (les
--      progrès référencent les IDs de leçon, conservés à l'upsert).
--   2. La PROGRESSION par user (état de gamification, complétion des leçons,
--      XP quotidien, succès). C'est là que vit le streak quotidien obligatoire.
--
-- Choix de modélisation : une leçon porte ses « items » pédagogiques en JSONB
-- (mot/phrase cible + traductions par langue source). Le lecteur de leçon côté
-- front dérive les exercices (choisir / traduire / associer) de ces items dans
-- la langue de l'apprenant — pas besoin de stocker chaque exercice ni des
-- distracteurs par langue.

-- Un cours = une langue cible (ce qu'on apprend). Les consignes d'UI viennent
-- de l'i18n ; les titres d'unité/leçon sont dans la langue cible (natif).
CREATE TABLE learn_courses (
    id         BIGSERIAL PRIMARY KEY,
    lang       TEXT NOT NULL UNIQUE,        -- code langue cible : 'en', 'es'…
    title      TEXT NOT NULL,               -- autonyme : 'English', 'Español'…
    sort_order INT  NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Une unité regroupe des leçons (ex. « Basics », « Greetings »). `idx` fige
-- l'ordre au sein du cours. `slug` stable pour l'upsert idempotent du contenu.
CREATE TABLE learn_units (
    id        BIGSERIAL PRIMARY KEY,
    course_id BIGINT NOT NULL REFERENCES learn_courses(id) ON DELETE CASCADE,
    slug      TEXT NOT NULL,
    idx       INT  NOT NULL,
    title     TEXT NOT NULL,
    UNIQUE (course_id, slug)
);
CREATE INDEX learn_units_course_idx ON learn_units (course_id, idx);

-- Une leçon = une poignée d'items pédagogiques + une récompense XP. `content`
-- JSONB : { "items": [ { "target": "Hello",
--                        "tr": { "fr": "Bonjour", "es": "Hola", … },
--                        "notes": "" }, … ] }.
CREATE TABLE learn_lessons (
    id       BIGSERIAL PRIMARY KEY,
    unit_id  BIGINT NOT NULL REFERENCES learn_units(id) ON DELETE CASCADE,
    slug     TEXT NOT NULL,
    idx      INT  NOT NULL,
    title    TEXT NOT NULL,
    xp       INT  NOT NULL DEFAULT 10,
    content  JSONB NOT NULL DEFAULT '{"items":[]}'::jsonb,
    UNIQUE (unit_id, slug)
);
CREATE INDEX learn_lessons_unit_idx ON learn_lessons (unit_id, idx);

-- État de gamification par user. Une ligne créée paresseusement au premier
-- accès. Le streak quotidien vit ici :
--   * current_streak grimpe de 1 quand l'apprenant valide une activité un jour
--     consécutif (last_active_day = today-1) ; repart à 1 après un trou.
--   * « at risk » et expiration sont calculés en lecture (lazy) à partir de
--     last_active_day vs jour UTC courant.
-- Les cœurs (vies) se régénèrent dans le temps : hearts_updated_at sert au
-- calcul lazy du nombre de cœurs régénérés depuis la dernière écriture.
CREATE TABLE learn_state (
    user_id           BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_xp          INT  NOT NULL DEFAULT 0,
    daily_goal        INT  NOT NULL DEFAULT 20,
    hearts            INT  NOT NULL DEFAULT 5,
    hearts_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_streak    INT  NOT NULL DEFAULT 0,
    longest_streak    INT  NOT NULL DEFAULT 0,
    last_active_day   DATE,
    last_milestone    INT  NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Complétion d'une leçon par un user. `stars` (0..3) reflète la performance
-- (mistakes faibles = 3). On garde le meilleur score. Sert à débloquer la
-- leçon suivante et à colorer le parcours.
CREATE TABLE learn_progress (
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id    BIGINT NOT NULL REFERENCES learn_lessons(id) ON DELETE CASCADE,
    stars        INT  NOT NULL DEFAULT 0,
    times_done   INT  NOT NULL DEFAULT 0,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, lesson_id)
);

-- XP gagné par jour (UTC). Alimente l'anneau d'objectif quotidien et le calcul
-- du streak (un jour « actif » = day présent ici). Historique conservé pour de
-- futures stats / ligues.
CREATE TABLE learn_daily (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     DATE   NOT NULL,
    xp      INT    NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
);

-- Succès débloqués. `code` identifie un succès défini en dur côté applicatif
-- (seuils XP, paliers de streak, premiers pas…). Insert idempotent.
CREATE TABLE learn_achievements (
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code        TEXT   NOT NULL,
    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, code)
);
