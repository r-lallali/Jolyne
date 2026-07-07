// Catalogue front des scénarios de jeu de rôle du prof IA. Doit rester
// aligné sur le catalogue serveur (backend internal/ws/bot_scenario.go) :
// mêmes IDs, mêmes flags free. Les libellés viennent de l'i18n
// (t.scenarios[id]) — ici uniquement l'identité et l'emoji.

export interface Scenario {
  id: string;
  emoji: string;
  free: boolean;
}

export const SCENARIOS: readonly Scenario[] = [
  { id: "restaurant", emoji: "🍽️", free: true },
  { id: "directions", emoji: "🗺️", free: true },
  { id: "interview", emoji: "💼", free: false },
  { id: "market", emoji: "🛒", free: false },
  { id: "doctor", emoji: "🩺", free: false },
];
