"use client";

import { useState } from "react";

import { setCardResponsible } from "@/lib/board/actions";
import type { MemberOption } from "@/lib/board/types";

export function Responsavel({
  cardId,
  responsibleId,
  members,
  onChanged,
}: {
  cardId: string;
  responsibleId: string | null;
  members: MemberOption[];
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);

  async function change(userId: string) {
    setSaving(true);
    await setCardResponsible(cardId, userId || null);
    setSaving(false);
    onChanged();
  }

  return (
    <select
      value={responsibleId ?? ""}
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
  );
}
