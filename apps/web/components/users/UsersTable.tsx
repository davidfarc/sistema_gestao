"use client";

import { UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { createUser, setUserRole } from "@/lib/board/actions";
import type { RoleOption, UserRow } from "@/lib/board/types";

export function UsersTable({ users, roles }: { users: UserRow[]; roles: RoleOption[] }) {
  const router = useRouter();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function change(userId: string, roleId: string) {
    if (!roleId) return;
    setSavingId(userId);
    await setUserRole(userId, roleId);
    setSavingId(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-high"
        >
          <UserPlus className="h-4 w-4" /> Adicionar usuário
        </button>
      </div>

      {users.length === 0 ? (
        <p className="text-sm text-secondary">
          Nenhum usuário ainda. Adicione um acima, ou eles são criados no primeiro login.
        </p>
      ) : (
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
      )}

      {adding && (
        <AddUserModal
          roles={roles}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function AddUserModal({
  roles,
  onClose,
  onCreated,
}: {
  roles: RoleOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [internal, setInternal] = useState(true);
  const [roleId, setRoleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await createUser({ email, name, internal, roleId: roleId || null });
    setBusy(false);
    if (res.ok) onCreated();
    else setError(res.error);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onClick={onClose}>
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-neutral-800">Adicionar usuário</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">E-mail</span>
            <input
              autoFocus
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pessoa@exemplo.com"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome da pessoa"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
          </label>

          <div className="flex gap-4">
            <label className="block flex-1">
              <span className="mb-1 block text-xs font-medium text-neutral-600">Acesso</span>
              <select
                value={internal ? "internal" : "external"}
                onChange={(e) => setInternal(e.target.value === "internal")}
                className="w-full rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm outline-none focus:border-neutral-500"
              >
                <option value="internal">interno</option>
                <option value="external">externo</option>
              </select>
            </label>
            <label className="block flex-1">
              <span className="mb-1 block text-xs font-medium text-neutral-600">Papel</span>
              <select
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm outline-none focus:border-neutral-500"
              >
                <option value="">— sem papel —</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-xs text-neutral-400">
            A conta é criada na hora, sem enviar e-mail. No primeiro login com Google (mesmo
            e-mail) ela é vinculada.
          </p>

          {error && <p className="text-xs font-medium text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-200 p-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!email.trim() || busy}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
          >
            {busy ? "Criando…" : "Criar"}
          </button>
        </div>
      </form>
    </div>
  );
}
