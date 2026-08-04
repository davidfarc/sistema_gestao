"use client";

import { Lock, Unlock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { setFieldEditors } from "@/lib/board/actions";
import type { FieldDef, MemberOption } from "@/lib/board/types";

/**
 * Alçada por propriedade: quem pode editar/marcar cada campo do pipeline.
 * Sem ninguém marcado = qualquer um que possa editar o card.
 */
export function FieldEditorsForm({
  fields,
  members,
}: {
  fields: FieldDef[];
  members: MemberOption[];
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, string[]>>(
    Object.fromEntries(fields.map((f) => [f.id, f.allowedEditors])),
  );

  async function toggle(fieldId: string, userId: string) {
    const current = local[fieldId] ?? [];
    const next = current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId];
    setLocal((p) => ({ ...p, [fieldId]: next }));
    setBusy(fieldId);
    await setFieldEditors(fieldId, next);
    setBusy(null);
    router.refresh();
  }

  async function clear(fieldId: string) {
    setLocal((p) => ({ ...p, [fieldId]: [] }));
    setBusy(fieldId);
    await setFieldEditors(fieldId, []);
    setBusy(null);
    router.refresh();
  }

  if (fields.length === 0) {
    return (
      <p className="text-sm text-secondary">
        Este pipeline ainda não tem propriedades. Crie na visão de Lista do quadro.
      </p>
    );
  }

  const nameOf = new Map(members.map((m) => [m.id, m.name]));

  return (
    <ul className="divide-y divide-surface-low rounded-xl border border-surface-medium bg-surface-lowest">
      {fields.map((f) => {
        const editors = local[f.id] ?? [];
        const restricted = editors.length > 0;
        const open = openId === f.id;
        return (
          <li key={f.id} className="p-3">
            <div className="flex items-center gap-2">
              {restricted ? (
                <Lock className="h-4 w-4 shrink-0 text-amber-600" />
              ) : (
                <Unlock className="h-4 w-4 shrink-0 text-neutral-300" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-800">{f.name}</p>
                <p className="truncate text-xs text-neutral-500">
                  {restricted
                    ? `Só ${editors.map((id) => nameOf.get(id) ?? "?").join(", ")}`
                    : "Qualquer um que possa editar o card"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : f.id)}
                disabled={busy === f.id}
                className="shrink-0 rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                {open ? "Fechar" : "Definir quem pode"}
              </button>
            </div>

            {open && (
              <div className="mt-3 rounded-lg bg-surface-low p-3">
                <div className="grid gap-1 sm:grid-cols-2">
                  {members.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm text-neutral-700">
                      <input
                        type="checkbox"
                        checked={editors.includes(m.id)}
                        onChange={() => toggle(f.id, m.id)}
                        disabled={busy === f.id}
                        className="h-4 w-4 rounded border-neutral-300"
                      />
                      <span className="truncate">{m.name}</span>
                    </label>
                  ))}
                </div>
                {restricted && (
                  <button
                    type="button"
                    onClick={() => clear(f.id)}
                    disabled={busy === f.id}
                    className="mt-3 text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-800"
                  >
                    Liberar para todos
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
