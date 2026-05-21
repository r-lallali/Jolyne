import DOMPurify from "dompurify";

// sanitizeMessage neutralise tout HTML reçu d'un peer avant rendu.
// Pipeline défense en profondeur (CLAUDE.md règle d'or #2) :
//   1. Le serveur applique `html.EscapeString` avant relais → `'` devient
//      `&#39;`, `<` devient `&lt;`, etc. Garantit la sûreté pour un client
//      tiers qui ferait innerHTML brut.
//   2. Côté navigateur, on décode ces entités pour l'affichage : React rend
//      en text node, donc le contenu décodé ne sera jamais interprété
//      comme du HTML — il s'affiche tel qu'écrit par l'utilisateur.
//   3. DOMPurify strip tout reste de balise au cas où une faille upstream
//      laisserait passer du HTML brut.
//
// SSR-safe : DOMPurify devient un no-op si window est absent.
export function sanitizeMessage(raw: string): string {
  const decoded = decodeEntities(raw);
  if (typeof window === "undefined") return decoded;
  return DOMPurify.sanitize(decoded, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
  });
}

// decodeEntities : inverse strict de `html.EscapeString` (Go std). Ne
// décode QUE les 5 entités produites par le serveur — un sur-décodage
// (ex: &#x27;) reste affiché tel quel, ce qui est intentionnel.
const ENTITY_MAP: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&#39;": "'",
  "&#34;": '"',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(?:lt|gt|amp|#39|#34);/g, (m) => ENTITY_MAP[m] ?? m);
}
