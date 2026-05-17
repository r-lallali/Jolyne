// Petite barre horizontale au sommet d'une bottom-sheet. Suggère
// l'affordance "balaie pour fermer" (sans implémenter le drag pour
// l'instant — la fermeture passe par le tap sur le backdrop ou un
// bouton Annuler). Masquée sur desktop où la modale est centrée.
export function SheetHandle() {
  return (
    <div className="-mt-1 mb-3 flex justify-center sm:hidden">
      <span
        aria-hidden
        className="h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700"
      />
    </div>
  );
}
