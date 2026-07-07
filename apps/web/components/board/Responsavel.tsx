"use client";

import { useState } from "react";

import { setStageResponsible } from "@/lib/board/actions";
import type { MemberOption } from "@/lib/board/types";

export function Responsavel({
  cardId,
  stageId,
  stageName,
  assignments,
  members,
  onChanged,
}: {
  cardId: string;
  stageId: string;
  stageName?: string;
  assignments: { stageId: string; userId: string }[];
  members: MemberOption[];
  onChanged: () => void;
}) {
  const current = assignments.find((a) => a.stageId === stageId)?.userId ?? "";
  const [saving, setSaving] = useState(false);

  async function change(userId: string) {
    setSaving(true);
    await setStageResponsible(cardId, stageId, userId || null);
    setSaving(false);
    onChanged();
  }

  return (
    <div>
      <select
        value={current}
        onChange={(e) => change(e.target.value)}
        disabled={saving}
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-500 disabled:opacity-60"
      >
        <option value="">— sem responsável —</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      {stageName && (
        <p className="mt-1 text-xs text-secondary">
          Responsável pela etapa atual: <span className="font-medium">{stageName}</span>
        </p>
      )}
    </div>
  );
}
