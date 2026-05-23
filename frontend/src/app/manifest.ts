import type { MetadataRoute } from "next";

// Manifest Web App pour PWA. Permet "Ajouter à l'écran d'accueil" sur iOS
// et le prompt d'install Android/Chrome.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jolyne",
    short_name: "Jolyne",
    description: "Pratique une langue avec un natif. 1-vs-1, texte uniquement.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      // Next.js sert `apple-icon.tsx` (180×180) à `/apple-icon` et le SVG
      // top-level à `/icon.svg`. Android Chrome accepte l'SVG comme any
      // size — pas besoin de PNG multiples.
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "maskable" },
    ],
  };
}
