// Mode immersion : traduction automatique des messages entrants, affichée
// sous chaque bulle (Premium — le quota illimité rend le volume soutenable).
// Le hook maintient un cache id → traduction et traduit séquentiellement
// (jamais de rafale parallèle quand un historique arrive d'un coup).

import { useEffect, useRef, useState } from "react";
import { guessSourceLang, translateText } from "@/lib/translate";

export interface AutoTranslateItem {
  id: string;
  body: string;
}

interface Options {
  enabled: boolean;
  // Langue attendue du peer (indice pour guessSourceLang) — null si inconnue.
  expected: string | null;
  // Langue d'affichage (langue native du user). null = hook inactif.
  target: string | null;
}

export function useAutoTranslations(
  items: AutoTranslateItem[],
  { enabled, expected, target }: Options,
): Record<string, string> {
  const [translations, setTranslations] = useState<Record<string, string>>({});
  // done retient aussi les échecs et les traductions inutiles (null) pour
  // ne jamais retenter le même message en boucle.
  const done = useRef(new Map<string, string | null>());
  // Chaîne de promesses = file séquentielle. Chaque traduction attend la
  // précédente ; les erreurs sont absorbées pour ne pas casser la chaîne.
  const queue = useRef<Promise<void>>(Promise.resolve());

  // Changement de langue cible (nouveau setup) : les traductions en cache
  // sont dans la mauvaise langue — on repart de zéro.
  const lastTarget = useRef(target);
  useEffect(() => {
    if (lastTarget.current === target) return;
    lastTarget.current = target;
    done.current.clear();
    setTranslations({});
  }, [target]);

  useEffect(() => {
    if (!enabled || !target) return;
    for (const item of items) {
      if (done.current.has(item.id)) continue;
      done.current.set(item.id, null); // réservé — pas de double envoi
      const { id, body } = item;
      const source = guessSourceLang(body, expected);
      queue.current = queue.current.then(async () => {
        try {
          const { translated } = await translateText(body, source, target);
          // Une traduction identique à l'original (message déjà dans la
          // langue du user) n'apporte rien — on n'affiche rien.
          if (
            translated &&
            translated.trim().toLowerCase() !== body.trim().toLowerCase()
          ) {
            done.current.set(id, translated);
            setTranslations((prev) => ({ ...prev, [id]: translated }));
          }
        } catch {
          // Échec silencieux (réseau, quota) : pas de ligne sous la bulle,
          // pas de re-tentative — le tap-to-translate manuel reste dispo.
        }
      });
    }
  }, [items, enabled, expected, target]);

  return translations;
}
