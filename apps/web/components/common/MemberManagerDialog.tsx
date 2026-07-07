"use client";

import clsx from "clsx";
import { Check, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type { MemberOption } from "@/lib/board/types";

/**
 * Diálogo genérico de membros: lista usuários internos com checkbox, alternando
 * a associação (a algum pipeline ou grupo). `topSlot` permite embutir extras
 * (ex.: renomear grupo).
 */
export function MemberManagerDialog({
  title,
  topSlot,
  load,
  onToggle,
  onClose,
}: {
  title: string;
  topSlot?: ReactNode;
  load: () => Promise<{ memberIds: string[]; users: MemberOption[] }>;
  onToggle: (userId: string, member: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [users, setUsers] = useState<MemberOption[]>([]);
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    load().then(({ memberIds, users }) => {
      setUsers(users);
      setMembers(new Set(memberIds));
    });
  }, [load]);

  async function toggle(userId: string) {
    const isMember = members.has(userId);
    setBusy(userId);
    await onToggle(userId, !isMember);
    setMembers((prev) => {
      const next = new Set(prev);
      if (isMember) next.delete(userId);
      else next.add(userId);
      return next;
    });
    setBusy(null);
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 pt-24"
      onClick={onClose}
    >
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {topSlot && <div className="border-b border-neutral-100 p-3">{topSlot}</div>}

        <ul className="max-h-80 overflow-y-auto p-2">
          {users.map((u) => {
            const on = members.has(u.id);
            return (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => toggle(u.id)}
                  disabled={busy === u.id}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-neutral-100 disabled:opacity-50"
                >
                  <span
                    className={clsx(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                      on ? "border-primary bg-primary text-white" : "border-neutral-300",
                    )}
                  >
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="truncate text-sm text-neutral-700">{u.name}</span>
                </button>
              </li>
            );
          })}
          {users.length === 0 && (
            <li className="px-2 py-3 text-xs text-neutral-400">Nenhum usuário interno.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
