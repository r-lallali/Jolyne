// Liste fermée de prompts style Hinge — clés stables stockées en DB,
// les libellés vivent dans le dictionnaire i18n sous `prompts.*`.
// Ajouter une clé ici = ajouter le libellé dans fr/en/es/de pour ne pas
// casser le typage.

export const PROMPT_KEYS = [
  "language_goal",
  "favorite_word",
  "dream_destination",
  "perfect_weekend",
  "guilty_pleasure",
  "best_advice",
  "two_truths_one_lie",
  "go_to_song",
  "comfort_food",
  "hot_take",
  "if_i_could_meet",
  "small_thing_makes_me_happy",
  "im_passionate_about",
  "im_learning",
  "im_proud_of",
] as const;

export type PromptKey = (typeof PROMPT_KEYS)[number];

export function isPromptKey(s: string): s is PromptKey {
  return (PROMPT_KEYS as readonly string[]).includes(s);
}
