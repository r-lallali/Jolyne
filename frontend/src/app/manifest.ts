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
      { src: "/icon1", sizes: "192x192", type: "image/png" },
      { src: "/icon2", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon2", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
