"use client";

import { Ban, Pencil, RotateCcw, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  createUser,
  importUser,
  setUserArchived,
  setUserGrant,
  setUserBoards,
  setUserCargo,
  setUserName,
  setUserRole,
} from "@/lib/board/actions";
import { setUserPhone } from "@/lib/profile/actions";
import type { BoardSummary, RoleOption, UserRow } from "@/lib/board/types";
import { CARGOS } from "@/lib/demandas/cargos";

/** Acessos pontuais que um Gestor concede por pessoa. */
const ACCESS = [
  { key: "salas", label: "Gestão de Vila" },
  { key: "novos", label: "Novos alunos" },
] as const;

export function UsersTable({
  users,
  roles,
  boards,
  canSetBoards,
}: {
  users: UserRow[];
  roles: RoleOption[];
  boards: BoardSummary[];
  canSetBoards: boolean;
}) {
  const router = useRouter();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [boardsFor, setBoardsFor] = useState<UserRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * As regras de papel e de revogação vivem no servidor (último gestor, externo
   * sem papel de gestão). Aqui só mostramos o motivo — duplicar a regra no
   * cliente seria mais uma cópia para divergir.
   */
  async function run(userId: string, fn: () => Promise<void>) {
    setSavingId(userId);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    }
    setSavingId(null);
    router.refresh();
  }

  const activeIds = new Set(boards.map((b) => b.id));
  const activeCount = (u: UserRow) => u.boardIds.filter((id) => activeIds.has(id)).length;

  const change = (userId: string, roleId: string) =>
    roleId ? run(userId, () => setUserRole(userId, roleId)) : undefined;

  const toggleArchived = (u: UserRow) => {
    const msg = u.archived
      ? `Devolver o acesso de ${u.name}?`
      : `Revogar o acesso de ${u.name}? O histórico dele é preservado.`;
    if (!confirm(msg)) return;
    return run(u.id, () => setUserArchived(u.id, !u.archived));
  };

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => setImporting(true)}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Importar lista
        </button>
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
                <th className="px-4 py-2 font-medium">Pipelines</th>
                <th className="px-4 py-2 font-medium">Acessos</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-low">
              {users.map((u) => (
                <tr key={u.id} className={u.archived ? "opacity-50" : undefined}>
                  <td className="px-4 py-2 font-medium text-neutral-800">
                    {u.name}
                    {u.archived && (
                      <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs font-medium text-neutral-600">
                        sem acesso
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-neutral-600">
                    {u.email}
                    <span className={"block text-xs " + (u.phone ? "text-neutral-500" : "text-amber-700")}>
                      {u.phone ?? (u.internal && !u.archived ? "sem telefone" : "")}
                    </span>
                  </td>
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
                    {u.cargo && <span className="mt-0.5 block text-xs text-neutral-500">Cargo: {u.cargo}</span>}
                  </td>
                  <td className="px-4 py-2">
                    {!u.internal ? (
                      <span className="text-xs text-neutral-500">pelos cards atribuídos</span>
                    ) : u.seesAllBoards ? (
                      <span className="text-xs text-neutral-600">Todos</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setBoardsFor(u)}
                        disabled={!canSetBoards || savingId === u.id}
                        title={canSetBoards ? "Escolher os pipelines que esta pessoa enxerga" : undefined}
                        className={
                          "rounded-lg border px-2 py-1 text-xs font-medium disabled:opacity-60 " +
                          (activeCount(u) === 0
                            ? "border-amber-300 bg-amber-50 text-amber-800"
                            : "border-neutral-300 text-neutral-700 hover:bg-neutral-50")
                        }
                      >
                        {activeCount(u) === 0
                          ? "Nenhum"
                          : `${activeCount(u)} ${activeCount(u) === 1 ? "pipeline" : "pipelines"}`}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {u.internal ? (
                      <div className="grid gap-1">
                        {ACCESS.map((a) => {
                          const byRole = u.roleGrants.includes(a.key);
                          return (
                            <label
                              key={a.key}
                              title={byRole ? "O papel desta pessoa já dá este acesso" : undefined}
                              className={"flex items-center gap-2 whitespace-nowrap text-xs " + (byRole ? "text-neutral-500" : "cursor-pointer text-neutral-800")}
                            >
                              <input
                                type="checkbox"
                                checked={byRole || u.grants.includes(a.key)}
                                disabled={byRole || savingId === u.id || u.archived}
                                onChange={(e) =>
                                  run(u.id, async () => {
                                    const res = await setUserGrant(u.id, a.key, e.target.checked);
                                    if (!res.ok) throw new Error(res.error);
                                  })
                                }
                                className="h-4 w-4"
                              />
                              {a.label}
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-xs text-neutral-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(u)}
                        disabled={savingId === u.id}
                        title="Editar nome, telefone e cargo"
                        aria-label={`Editar ${u.name}`}
                        className="rounded p-1 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleArchived(u)}
                        disabled={savingId === u.id}
                        title={u.archived ? "Devolver acesso" : "Revogar acesso"}
                        aria-label={`${u.archived ? "Devolver" : "Revogar"} acesso de ${u.name}`}
                        className="rounded p-1 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                      >
                        {u.archived ? (
                          <RotateCcw className="h-4 w-4" />
                        ) : (
                          <Ban className="h-4 w-4" />
                        )}
                      </button>
                    </div>
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

      {importing && (
        <ImportUsersModal
          roles={roles}
          boards={boards}
          canSetBoards={canSetBoards}
          onClose={() => {
            setImporting(false);
            router.refresh();
          }}
        />
      )}

      {boardsFor && (
        <BoardsModal
          user={boardsFor}
          boards={boards}
          onClose={() => setBoardsFor(null)}
          onSaved={() => {
            setBoardsFor(null);
            router.refresh();
          }}
        />
      )}

      {editing && (
        <EditNameModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/** Edita o nome exibido, o telefone e o cargo. Papel e acessos são editados direto na linha. */
function EditNameModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [cargo, setCargo] = useState(user.cargo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (name.trim() !== user.name) await setUserName(user.id, name);
      if (cargo !== (user.cargo ?? "")) await setUserCargo(user.id, cargo || null);
      if (phone.trim() !== (user.phone ?? "")) {
        const res = await setUserPhone(user.id, phone);
        if (!res.ok) throw new Error(res.error);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onClick={onClose}>
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-neutral-800">Editar usuário</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-600 hover:bg-neutral-100"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">Nome</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">Telefone (WhatsApp)</span>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(84) 99999-8888"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
            <span className="mt-1 block text-xs text-neutral-600">
              É por ele que o assistente do WhatsApp reconhece a pessoa. Deixe vazio para remover.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">Cargo</span>
            <select
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500"
            >
              <option value="">— sem cargo —</option>
              {CARGOS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-neutral-600">
              O cargo define quem aprova demandas em cada faixa de alçada. Não libera acesso a telas.
            </span>
          </label>

          <p className="text-xs text-neutral-600">
            O e-mail ({user.email}) não muda: é a identidade no Google. Interno/externo vem do
            domínio do e-mail.
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
            disabled={!name.trim() || busy}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
          >
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
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
  const [roleId, setRoleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await createUser({ email, name, roleId: roleId || null });
    setBusy(false);
    if (res.ok) onCreated();
    else setError(res.error);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onClick={onClose}>
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-neutral-800">Adicionar usuário</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-600 hover:bg-neutral-100"
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

          <label className="block">
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

          <p className="text-xs text-neutral-600">
            A conta é criada na hora, sem enviar e-mail. No primeiro login com Google (mesmo
            e-mail) ela é vinculada. <strong>Interno ou externo vem do domínio do e-mail</strong> —
            e papéis de gestão só podem ser dados a e-mails do domínio da organização.
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

/** Pipelines que a pessoa enxerga (Gestor de área e membro interno). */
function BoardsModal({
  user,
  boards,
  onClose,
  onSaved,
}: {
  user: UserRow;
  boards: BoardSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [picked, setPicked] = useState(() => new Set(user.boardIds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string, on: boolean) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setUserBoards(user.id, [...picked]);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:pt-24" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="boards-modal-title"
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h3 id="boards-modal-title" className="text-sm font-semibold text-neutral-800">
            Pipelines de {user.name}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-600 hover:bg-neutral-100"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">
          <p className="text-sm text-neutral-600">
            Marque os pipelines que esta pessoa enxerga. Ela vê os cards, o quadro e os painéis só
            deles; o resto fica escondido.
          </p>
          <div className="mt-3 flex gap-3 text-xs">
            <button type="button" onClick={() => setPicked(new Set(boards.map((b) => b.id)))} className="font-medium text-primary hover:underline">
              Marcar todos
            </button>
            <button type="button" onClick={() => setPicked(new Set())} className="font-medium text-primary hover:underline">
              Desmarcar todos
            </button>
          </div>
          <ul className="mt-2 max-h-80 divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200">
            {boards.map((b) => (
              <li key={b.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm text-neutral-800 hover:bg-neutral-50">
                  <input
                    type="checkbox"
                    checked={picked.has(b.id)}
                    onChange={(e) => toggle(b.id, e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span className="break-words">{b.name}</span>
                </label>
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-200 px-4 py-3">
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700">
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
          >
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

type ImportRow = { email: string; state: "fila" | "criado" | "ja_existia" | "erro"; note?: string };

/** Importação em lote: cola-se a lista de e-mails, escolhe-se papel e pipelines. */
function ImportUsersModal({
  roles,
  boards,
  canSetBoards,
  onClose,
}: {
  roles: RoleOption[];
  boards: BoardSummary[];
  canSetBoards: boolean;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [roleId, setRoleId] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const emails = [...new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const invalid = emails.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

  async function run() {
    if (emails.length === 0 || invalid.length > 0 || busy) return;
    setBusy(true);
    const state: ImportRow[] = emails.map((email) => ({ email, state: "fila" }));
    setRows(state);
    // Um por vez: cada e-mail é uma ida curta ao servidor, e a lista mostra o andamento.
    for (let i = 0; i < state.length; i++) {
      let next: ImportRow;
      try {
        const res = await importUser({ email: state[i]!.email, roleId: roleId || null, boardIds: [...picked] });
        next = res.ok ? { email: state[i]!.email, state: res.status } : { email: state[i]!.email, state: "erro", note: res.error };
      } catch {
        next = { email: state[i]!.email, state: "erro", note: "Falha de conexão." };
      }
      state[i] = next;
      setRows([...state]);
    }
    setBusy(false);
  }

  const LABEL = { fila: "na fila…", criado: "criado", ja_existia: "já existia", erro: "erro" } as const;
  const TONE = { fila: "text-neutral-500", criado: "text-emerald-700", ja_existia: "text-neutral-600", erro: "text-red-700" } as const;
  const count = (s: ImportRow["state"]) => rows?.filter((r) => r.state === s).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:pt-16" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-users-title"
        className="w-full max-w-lg rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-neutral-200 px-5 py-4">
          <h3 id="import-users-title" className="text-base font-semibold text-neutral-800">
            Importar lista de usuários
          </h3>
          <p className="mt-1 text-sm text-neutral-600">
            Cole os e-mails, um por linha. Cada pessoa entra com a própria conta Google; o nome é
            preenchido no primeiro acesso.
          </p>
        </div>

        {rows ? (
          <div className="p-5">
            <p className="text-sm text-neutral-800" role="status">
              {busy
                ? `Importando… ${rows.length - count("fila")} de ${rows.length}`
                : `Pronto: ${count("criado")} criados, ${count("ja_existia")} já existiam, ${count("erro")} com erro.`}
            </p>
            <ul className="mt-3 max-h-80 divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200 text-sm">
              {rows.map((r) => (
                <li key={r.email} className="flex flex-wrap items-baseline gap-x-3 px-3 py-1.5">
                  <span className="min-w-0 flex-1 break-all text-neutral-800">{r.email}</span>
                  <span className={"shrink-0 font-medium " + TONE[r.state]}>{LABEL[r.state]}</span>
                  {r.note && <span className="w-full text-xs text-red-700">{r.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="grid gap-4 p-5">
            <label className="grid gap-1 text-sm text-neutral-700">
              E-mails
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder={"pessoa1@editoraeccoprime.com.br\npessoa2@editoraeccoprime.com.br"}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
              <span className="text-xs text-neutral-600">
                {emails.length} {emails.length === 1 ? "e-mail" : "e-mails"}
                {invalid.length > 0 && <span className="text-red-700"> · inválidos: {invalid.join(", ")}</span>}
              </span>
            </label>
            <label className="grid gap-1 text-sm text-neutral-700">
              Papel de quem for criado
              <select
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                className="min-h-10 rounded-lg border border-neutral-300 bg-white px-2 text-sm"
              >
                <option value="">Papel padrão (definido no primeiro acesso)</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            {canSetBoards && boards.length > 0 && (
              <fieldset className="grid gap-1">
                <legend className="mb-1 text-sm text-neutral-700">Pipelines que essas pessoas enxergam</legend>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-200">
                  {boards.map((b) => (
                    <label key={b.id} className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-1.5 text-sm text-neutral-800 hover:bg-neutral-50">
                      <input
                        type="checkbox"
                        checked={picked.has(b.id)}
                        onChange={(e) =>
                          setPicked((cur) => {
                            const next = new Set(cur);
                            if (e.target.checked) next.add(b.id);
                            else next.delete(b.id);
                            return next;
                          })
                        }
                        className="h-4 w-4"
                      />
                      <span className="break-words">{b.name}</span>
                    </label>
                  ))}
                </div>
                <span className="text-xs text-neutral-600">
                  Para quem já existe, os pipelines marcados são acrescentados; o papel não muda.
                </span>
              </fieldset>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-neutral-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-10 rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700 disabled:opacity-50"
          >
            {rows ? "Fechar" : "Cancelar"}
          </button>
          {!rows && (
            <button
              type="button"
              onClick={run}
              disabled={emails.length === 0 || invalid.length > 0}
              className="min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
            >
              Importar {emails.length > 0 ? emails.length : ""}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
