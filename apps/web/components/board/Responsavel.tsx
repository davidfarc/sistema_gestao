"use client";

import { useEffect, useState } from "react";

import { loadCardAssignments, loadMembers, setStageResponsible } from "@/lib/board/actions";
import type { MemberOption } from "@/lib/board/types";

export function Responsavel({
  cardId,
  stageId,
  stageName,
  onChange,
}: {
  cardId: string;
  stageId: string;
  stageName?: string;
  onChange?: () => void;
}) {
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [current, setCurrent] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([loadMembers(), loadCardAssignments(cardId)]).then(([m, a]) => {
      if (!active) return;
      setMembers(m);
      setCurrent(a.find((x) => x.stageId === stageId)?.userId ?? "");
    });
    return () => {
      active = false;
    };
  }, [cardId, stageId]);

  async function change(userId: string) {
    setCurrent(userId);
    setSaving(true);
    await setStageResponsible(cardId, stageId, userId || null);
    setSaving(false);
    onChange?.();
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
