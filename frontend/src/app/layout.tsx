import { Inter } from "next/font/google";
import type { Metadata, Viewport } from "next";
import { AuthBootstrap } from "@/components/auth/AuthBootstrap";
import { ChatWordmark } from "@/components/ChatWordmark";
import { ThemeToggle } from "@/components/ThemeToggle";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Jolyne",
  description: "Pratique une langue avec un natif. 1-vs-1, texte uniquement.",
  robots: { index: true, follow: true },
  // PWA / "Ajouter à l'écran d'accueil" iOS : on annonce qu'on tourne en
  // standalone (sans barre Safari). Le manifest gère le reste pour Android.
  appleWebApp: {
    capable: true,
    title: "Jolyne",
    statusBarStyle: "black-translucent",
  },
};

// Viewport "app" : pas de pinch-zoom (comportement attendu d'un chat,
// évite le zoom accidentel à 2 doigts), interactiveWidget=resizes-content
// pour que le clavier mobile ne masque pas l'input.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className="font-sans antialiased">
        <AuthBootstrap />
        <ChatWordmark />
        <div className="fixed right-3 top-3 z-50 sm:right-4 sm:top-4">
          <ThemeToggle />
        </div>
        {children}
      </body>
    </html>
  );
}
