"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { setBoardIntake } from "@/lib/board/actions";
import type { Intake } from "@/lib/board/types";
import type { MemberOption } from "@/lib/board/types";

/**
 * Quem pode abrir demandas neste pipeline.
 *
 * Fica em Alçadas, junto das demais autoridades do pipeline — foi onde o
 * usuário foi procurar, e é onde a pergunta "quem tem autoridade para quê"
 * já é respondida.
 */
export function IntakeForm({
  boardId,
  initial,
  initialUserIds,
  members,
}: {
  boardId: string;
  initial: Intake;
  initialUserIds: string[];
  members: MemberOption[];
}) {
  const router = useRouter();
  const [modo, setModo] = useState<Intake>(initial);
  const [ids, setIds] = useState<Set<string>>(new Set(initialUserIds));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function salvar() {
    setBusy(true);
    setError(null);
    setMsg(null);
    const res = await setBoardIntake(boardId, modo, [...ids]);
    setBusy(false);
    if (res.ok) {
      setMsg("Salvo.");
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  const OPCOES: { key: Intake; label: string; hint: string }[] = [
    {
      key: "members",
      label: "Só quem tem acesso ao pipeline",
      hint: "Padrão. Ninguém de fora consegue abrir o formulário.",
    },
    {
      key: "org",
      label: "Todos da equipe",
      hint: "Qualquer pessoa interna pode abrir uma solicitação, mesmo sem ver o quadro.",
    },
    {
      key: "users",
      label: "Pessoas específicas",
      hint: "Só quem você marcar abaixo.",
    },
  ];

  return (
    <div className="max-w-xl">
      <div className="space-y-1">
        {OPCOES.map((o) => (
          <label
            key={o.key}
            className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-neutral-50"
          >
            <input
              type="radio"
              name="intake"
              checked={modo === o.key}
              onChange={() => setModo(o.key)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm text-neutral-800">{o.label}</span>
              <span className="block text-xs text-neutral-500">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {modo === "users" && (
        <div className="mt-3 max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-neutral-200 p-2">
          {members.length === 0 ? (
            <p className="px-2 py-1 text-sm text-secondary">Nenhum usuário cadastrado.</p>
          ) : (
            members.map((m) => (
              <label
                key={m.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-neutral-50"
              >
                <input type="checkbox" checked={ids.has(m.id)} onChange={() => toggle(m.id)} />
                <span className="text-neutral-800">{m.name}</span>
              </label>
            ))
          )}
        </div>
      )}

      {modo !== "members" && (
        <p className="mt-3 rounded-lg border border-neutral-200 bg-surface-low px-3 py-2 text-xs text-neutral-600">
          Quem abrir uma solicitação por aqui <strong>não passa a ver o pipeline</strong> — enxerga
          apenas os próprios pedidos, para acompanhar o andamento.
        </p>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {msg && <p className="mt-3 text-sm text-emerald-700">{msg}</p>}

      <button
        type="button"
        onClick={salvar}
        disabled={busy}
        className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
      >
        {busy ? "Salvando…" : "Salvar"}
      </button>
    </div>
  );
}
