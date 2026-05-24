import type { Metadata } from "next";
import { LegalContent } from "./LegalContent";

export const metadata: Metadata = {
  title: "Mentions légales — Jolyne",
  description: "Conditions d'utilisation, confidentialité et contact DSA.",
};

export default function LegalPage() {
  return <LegalContent />;
}
