"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";

import type { CardView, StageView } from "@/lib/board/types";

const col = createColumnHelper<CardView>();

export function ListView({
  cards,
  stages,
}: {
  cards: CardView[];
  stages: StageView[];
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "number", desc: false }]);

  const stageName = useMemo(() => {
    const m = new Map(stages.map((s) => [s.id, s.name]));
    return (id: string) => m.get(id) ?? "—";
  }, [stages]);

  const columns = useMemo(
    () => [
      col.accessor("number", {
        header: "#",
        cell: (c) => <span className="font-medium text-neutral-500">#{c.getValue()}</span>,
      }),
      col.accessor("code", {
        header: "Código",
        cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span>,
      }),
      col.accessor("title", { header: "Título" }),
      col.accessor("materia", { header: "Matéria" }),
      col.accessor("serie", { header: "Série" }),
      col.accessor("bimestre", {
        header: "Bim.",
        cell: (c) => (c.getValue() === 0 ? "Anual" : `${c.getValue()}º`),
      }),
      col.accessor((r) => stageName(r.stageId), {
        id: "stage",
        header: "Etapa",
      }),
      col.accessor((r) => r.assignee?.name ?? "", {
        id: "assignee",
        header: "Responsável",
        cell: (c) => c.getValue() || <span className="text-neutral-300">—</span>,
      }),
      col.accessor((r) => r.status?.label ?? "", {
        id: "status",
        header: "Status",
        cell: (c) => {
          const v = c.row.original.status;
          return v ? (
            <span className={"rounded px-1.5 py-0.5 text-[11px] font-medium " + v.colorClass}>
              {v.label}
            </span>
          ) : (
            <span className="text-neutral-300">—</span>
          );
        },
      }),
    ],
    [stageName],
  );

  const table = useReactTable({
    data: cards,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} className="whitespace-nowrap px-3 py-2 font-medium">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-neutral-800"
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    <span className="text-neutral-400">
                      {h.column.getIsSorted() === "asc"
                        ? "▲"
                        : h.column.getIsSorted() === "desc"
                          ? "▼"
                          : ""}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-neutral-50">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="whitespace-nowrap px-3 py-2 text-neutral-700">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
