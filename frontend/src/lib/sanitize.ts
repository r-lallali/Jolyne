import DOMPurify from "dompurify";

// sanitizeMessage neutralise tout HTML reçu d'un peer avant rendu.
// Le serveur ne réécrit pas le contenu — la défense XSS vit ici, doublée
// par le rendu React en text node (CLAUDE.md règle d'or #2).
//
// SSR-safe : DOMPurify devient un no-op si window est absent (l'appel n'a
// pas vraiment lieu côté serveur, mais on garde le typage stable).
export function sanitizeMessage(raw: string): string {
  if (typeof window === "undefined") return raw;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
  });
}
