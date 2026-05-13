import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jolyne",
  description:
    "Parle avec un natif. Pratique une langue. 1-vs-1, anonyme, texte uniquement.",
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
