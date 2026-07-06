"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { setUserRole } from "@/lib/board/actions";
import type { RoleOption, UserRow } from "@/lib/board/types";

export function UsersTable({ users, roles }: { users: UserRow[]; roles: RoleOption[] }) {
  const router = useRouter();
  const [savingId, setSavingId] = useState<string | null>(null);

  async function change(userId: string, roleId: string) {
    if (!roleId) return;
    setSavingId(userId);
    await setUserRole(userId, roleId);
    setSavingId(null);
    router.refresh();
  }

  if (users.length === 0) {
    return (
      <p className="text-sm text-secondary">
        Nenhum usuário ainda. Os usuários são criados automaticamente no primeiro login.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-surface-medium bg-surface-lowest">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-surface-medium bg-surface-low text-xs text-secondary">
          <tr>
            <th className="px-4 py-2 font-medium">Nome</th>
            <th className="px-4 py-2 font-medium">E-mail</th>
            <th className="px-4 py-2 font-medium">Acesso</th>
            <th className="px-4 py-2 font-medium">Papel</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-low">
          {users.map((u) => (
            <tr key={u.id}>
              <td className="px-4 py-2 font-medium text-neutral-800">{u.name}</td>
              <td className="px-4 py-2 text-neutral-600">{u.email}</td>
              <td className="px-4 py-2">
                <span
                  className={
                    "rounded px-1.5 py-0.5 text-xs font-medium " +
                    (u.internal
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700")
                  }
                >
                  {u.internal ? "interno" : "externo"}
                </span>
              </td>
              <td className="px-4 py-2">
                <select
                  value={u.roleId ?? ""}
                  onChange={(e) => change(u.id, e.target.value)}
                  disabled={savingId === u.id}
                  className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-500 disabled:opacity-60"
                >
                  <option value="">— sem papel —</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
