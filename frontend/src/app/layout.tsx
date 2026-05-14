import { Inter } from "next/font/google";
import type { Metadata } from "next";
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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className="font-sans antialiased">
        {/* Wordmark visible seulement sur desktop — sur mobile la barre de
            chat porte déjà toutes les commandes utiles (pseudo + actions +
            theme), pas la peine d'y rajouter le nom de l'app. */}
        <p className="fixed left-4 top-4 z-50 hidden text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 sm:block">
          Jolyne
        </p>
        <div className="fixed right-3 top-3 z-50 sm:right-4 sm:top-4">
          <ThemeToggle />
        </div>
        {children}
      </body>
    </html>
  );
}
