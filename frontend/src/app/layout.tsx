import { Inter } from "next/font/google";
import type { Metadata } from "next";
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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className="font-sans antialiased">
        <ChatWordmark />
        <div className="fixed right-3 top-3 z-50 sm:right-4 sm:top-4">
          <ThemeToggle />
        </div>
        {children}
      </body>
    </html>
  );
}
