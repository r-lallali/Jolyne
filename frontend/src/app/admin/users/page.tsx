"use client";

import Link from "next/link";
import { useState } from "react";
import { searchUsers, statsURL } from "@/lib/adminStats";
import {
  Card,
  CsvLink,
  ErrorBox,
  PageHeader,
  Skeleton,
  useAuthedData,
} from "@/components/admin/ui";

export default function UsersPage() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const { data: users, loading, error } = useAuthedData(
    () => searchUsers(query, 100, 0),
    [query],
  );

  return (
    <div className="px-6 py-8">
      <PageHeader
        title="Utilisateurs"
        subtitle="Recherche par email ou id, fiche détaillée et actions."
        actions={
          <CsvLink href={statsURL(`/api/admin/stats/users?q=${encodeURIComponent(query)}&limit=1000&format=csv`)} />
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(input.trim());
        }}
        className="mb-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="email ou id…"
          className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900"
        />
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Rechercher
        </button>
      </form>

      {error && <ErrorBox message={error} />}
      {loading && <Skeleton className="h-64" />}

      {users && (
        <Card>
          {users.length === 0 ? (
            <p className="text-sm text-neutral-500">Aucun utilisateur.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-neutral-400">
                  <tr>
                    <th className="px-2 py-1.5">ID</th>
                    <th className="px-2 py-1.5">Email</th>
                    <th className="px-2 py-1.5">Plan</th>
                    <th className="px-2 py-1.5">Vérifié</th>
                    <th className="px-2 py-1.5">Inscrit</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className="border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/40"
                    >
                      <td className="px-2 py-1.5 tabular-nums text-neutral-500">{u.id}</td>
                      <td className="px-2 py-1.5">
                        <Link
                          href={`/admin/users/${u.id}`}
                          className="font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                        >
                          {u.email}
                        </Link>
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            u.plan === "premium"
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                              : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
                          }`}
                        >
                          {u.plan}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">{u.verified ? "✓" : "—"}</td>
                      <td className="px-2 py-1.5 text-neutral-500">
                        {new Date(u.created_at).toLocaleDateString("fr-FR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
