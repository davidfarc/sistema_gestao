"use client";

import { useRouter } from "next/navigation";

/** Troca o pipeline em foco nas telas de configuração (via querystring). */
export function PipelinePicker({
  boards,
  boardId,
}: {
  boards: { id: string; name: string }[];
  boardId: string;
}) {
  const router = useRouter();
  return (
    <select
      value={boardId}
      onChange={(e) => router.push(`/configuracoes/alcadas?board=${e.target.value}`)}
      className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500"
    >
      {boards.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}
