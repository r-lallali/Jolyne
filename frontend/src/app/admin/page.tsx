import { redirect } from "next/navigation";

// /admin → /admin/reports (entrée par défaut du back-office).
export default function AdminIndex() {
  redirect("/admin/reports");
}
