"use client";

import type { Action } from "@ecco/core";
import { Lock, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createRole, deleteRole, updateRole, type RoleDetail } from "@/lib/roles/actions";
import { ACTION_GROUPS, ehPapelAdministrativo } from "@/lib/roles/catalog";

/**
 * Editor de papéis: define o escopo de cada função do organograma.
 *
 * Um papel por vez, à esquerda a lista e à direita as permissões agrupadas por
 * área. As regras duras (não ficar sem Gestor Master, não excluir papel em uso,
 * papel administrativo sem usuário externo) moram no servidor — aqui só
 * exibimos o motivo da recusa.
 */
export function RolesEditor({ roles }: { roles: RoleDetail[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(roles[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const selected = roles.find((r) => r.id === selectedId) ?? null;

  // Rascunho local: só vai ao servidor quando a pessoa salva.
  const [draftName, setDraftName] = useState("");
  const [draftPerms, setDraftPerms] = useState<Set<string>>(new Set());
  const [draftFor, setDraftFor] = useState<string | null>(null);

  if (selected && draftFor !== selected.id) {
    setDraftFor(selected.id);
    setDraftName(selected.name);
    setDraftPerms(new Set(selected.permissions));
  }

  const sujo =
    selected != null &&
    (draftName !== selected.name ||
      draftPerms.size !== selected.permissions.length ||
      selected.permissions.some((p) => !draftPerms.has(p)));

  function toggle(action: Action) {
    setDraftPerms((prev) => {
      const next = new Set(prev);
      if (next.has(action)) next.delete(action);
      else next.add(action);
      return next;
    });
  }

  async function salvar() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await updateRole(selected.id, draftName, [...draftPerms]);
    setBusy(false);
    if (res.ok) {
      setOk("Papel atualizado.");
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  async function novo() {
    const nome = prompt("Nome do novo papel (ex.: Coordenação)");
    if (!nome?.trim()) return;
    setBusy(true);
    setError(null);
    const res = await createRole(nome, []);
    setBusy(false);
    if (res.ok) {
      setSelectedId(res.id);
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  async function excluir(r: RoleDetail) {
    if (!confirm(`Excluir o papel "${r.name}"?`)) return;
    setBusy(true);
    setError(null);
    const res = await deleteRole(r.id);
    setBusy(false);
    if (res.ok) {
      setSelectedId(null);
      setDraftFor(null);
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {ok && (
        <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {ok}
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <aside className="space-y-1">
          {roles.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className={
                "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition " +
                (r.id === selectedId
                  ? "bg-primary text-white"
                  : "text-neutral-700 hover:bg-neutral-100")
              }
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.name}</span>
                <span
                  className={
                    "block text-xs " + (r.id === selectedId ? "text-white/70" : "text-neutral-400")
                  }
                >
                  {r.users === 0
                    ? "ninguém"
                    : r.users === 1
                      ? "1 pessoa"
                      : `${r.users} pessoas`}
                </span>
              </span>
              {r.slug && (
                <Lock
                  className={
                    "h-3.5 w-3.5 shrink-0 " +
                    (r.id === selectedId ? "text-white/60" : "text-neutral-300")
                  }
                />
              )}
            </button>
          ))}

          <button
            type="button"
            onClick={novo}
            disabled={busy}
            className="mt-2 flex w-full items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 hover:bg-neutral-50"
          >
            <Plus className="h-4 w-4" /> Novo papel
          </button>
        </aside>

        {selected ? (
          <section>
            <div className="flex items-end gap-3">
              <label className="flex-1">
                <span className="mb-1 block text-xs font-medium text-neutral-600">
                  Nome do papel
                </span>
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
                />
              </label>
              {!selected.slug && (
                <button
                  type="button"
                  onClick={() => excluir(selected)}
                  disabled={busy}
                  className="rounded-lg border border-neutral-200 p-2 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                  title="Excluir papel"
                  aria-label={`Excluir ${selected.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            {selected.slug && (
              <p className="mt-2 text-xs text-neutral-400">
                Papel de sistema: o cadastro automático de novos usuários depende dele, então
                pode ser renomeado e ajustado, mas não excluído.
              </p>
            )}

            {ehPapelAdministrativo([...draftPerms] as Action[]) && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Este é um papel administrativo. Só o Gestor Master pode atribuí-lo a alguém, e
                ele nunca pode ficar com usuário externo.
              </p>
            )}

            <div className="mt-5 space-y-5">
              {ACTION_GROUPS.map((g) => (
                <div key={g.title}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-secondary">
                    {g.title}
                  </h3>
                  <div className="mt-2 space-y-1">
                    {g.items.map((item) => (
                      <label
                        key={item.action}
                        className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-neutral-50"
                      >
                        <input
                          type="checkbox"
                          checked={draftPerms.has(item.action)}
                          onChange={() => toggle(item.action)}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block text-sm text-neutral-800">{item.label}</span>
                          <span className="block text-xs text-neutral-500">{item.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="sticky bottom-0 mt-6 flex items-center gap-3 border-t border-neutral-200 bg-white/95 py-3">
              <button
                type="button"
                onClick={salvar}
                disabled={!sujo || busy}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
              >
                {busy ? "Salvando…" : "Salvar alterações"}
              </button>
              {sujo && <span className="text-xs text-neutral-500">Há mudanças não salvas.</span>}
            </div>
          </section>
        ) : (
          <p className="text-sm text-secondary">Selecione um papel à esquerda.</p>
        )}
      </div>
    </div>
  );
}
