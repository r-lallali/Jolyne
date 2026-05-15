import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin — Jolyne",
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-dvh">{children}</div>;
}
