"use client";

import clsx from "clsx";
import { Filter, Plus, Search, X } from "lucide-react";

import {
  defaultOp,
  opNeedsValue,
  opsFor,
  type FilterOp,
  type PropFilter,
} from "@/lib/board/filters";
import type { FieldDef, MemberOption } from "@/lib/board/types";

export type SortKey =
  | "number"
  | "title"
  | "stage"
  | "solicitante"
  | "responsavel"
  | "rice"
  | "orcamento";

export interface ListFilters {
  query: string;
  props: PropFilter[];
}

export const EMPTY_FILTERS: ListFilters = { query: "", props: [] };

let seq = 0;
const nextId = () => `f${++seq}`;

/** Busca por nome + filtros por propriedade (modelo Notion). */
export function ListToolbar({
  filters,
  onChange,
  fields,
  members,
  total,
  shown,
}: {
  filters: ListFilters;
  onChange: (f: ListFilters) => void;
  fields: FieldDef[];
  members: MemberOption[];
  total: number;
  shown: number;
}) {
  const set = (patch: Partial<ListFilters>) => onChange({ ...filters, ...patch });
  const fieldById = new Map(fields.map((f) => [f.id, f]));

  function addFilter() {
    const first = fields[0];
    if (!first) return;
    set({
      props: [
        ...filters.props,
        { id: nextId(), fieldId: first.id, op: defaultOp(first.type), value: "" },
      ],
    });
  }

  function update(id: string, patch: Partial<PropFilter>) {
    set({ props: filters.props.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  }

  function remove(id: string) {
    set({ props: filters.props.filter((f) => f.id !== id) });
  }

  const dirty = filters.query !== "" || filters.props.length > 0;
  const ctrl =
    "rounded-lg border border-neutral-300 bg-white py-1 pl-2 pr-6 text-sm outline-none focus:border-neutral-500";

  return (
    <div className="mb-3 grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="Buscar por nome ou #"
            className="w-full rounded-lg border border-neutral-300 py-1 pl-7 pr-2 text-sm outline-none focus:border-neutral-500"
          />
        </div>

        <button
          type="button"
          onClick={addFilter}
          disabled={fields.length === 0}
          title={fields.length === 0 ? "Este pipeline ainda não tem propriedades" : "Filtrar por propriedade"}
          className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
        >
          <Filter className="h-3.5 w-3.5" /> Filtro
        </button>

        {dirty && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-neutral-500 hover:text-neutral-800"
          >
            <X className="h-3 w-3" /> Limpar
          </button>
        )}

        <span className="ml-auto text-xs text-neutral-400">
          {shown === total ? `${total} cards` : `${shown} de ${total}`}
        </span>
      </div>

      {filters.props.length > 0 && (
        <div className="grid gap-1.5 rounded-lg bg-neutral-50 p-2">
          {filters.props.map((f) => {
            const field = fieldById.get(f.fieldId);
            if (!field) return null;
            return (
              <div key={f.id} className="flex flex-wrap items-center gap-1.5">
                <select
                  value={f.fieldId}
                  onChange={(e) => {
                    const next = fieldById.get(e.target.value);
                    update(f.id, {
                      fieldId: e.target.value,
                      op: next ? defaultOp(next.type) : f.op,
                      value: "",
                    });
                  }}
                  className={ctrl}
                >
                  {fields.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>

                <select
                  value={f.op}
                  onChange={(e) => update(f.id, { op: e.target.value as FilterOp, value: "" })}
                  className={ctrl}
                >
                  {opsFor(field.type).map((o) => (
                    <option key={o.op} value={o.op}>
                      {o.label}
                    </option>
                  ))}
                </select>

                {opNeedsValue(f.op) && (
                  <ValueInput
                    field={field}
                    members={members}
                    value={f.value}
                    onChange={(v) => update(f.id, { value: v })}
                  />
                )}

                <button
                  type="button"
                  onClick={() => remove(f.id)}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
                  aria-label="Remover filtro"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addFilter}
            className="inline-flex w-fit items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-primary hover:underline"
          >
            <Plus className="h-3 w-3" /> Adicionar filtro
          </button>
        </div>
      )}
    </div>
  );
}

/** Campo de valor conforme o tipo da propriedade. */
function ValueInput({
  field,
  members,
  value,
  onChange,
}: {
  field: FieldDef;
  members: MemberOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const ctrl =
    "rounded-lg border border-neutral-300 bg-white py-1 px-2 text-sm outline-none focus:border-neutral-500";

  if (field.type === "select" || field.type === "status") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={ctrl + " pr-6"}>
        <option value="">escolha…</option>
        {field.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "member") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={ctrl + " pr-6"}>
        <option value="">escolha…</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="valor"
      className={clsx(ctrl, "w-36")}
    />
  );
}

/** Cabeçalho de coluna clicável (ordenação). */
export function SortHeader({
  label,
  sortKey,
  current,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = current === sortKey;
  return (
    <th className={clsx("whitespace-nowrap px-3 py-2 font-medium", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={clsx(
          "inline-flex items-center gap-1 hover:text-neutral-800",
          active && "text-neutral-800",
        )}
      >
        {label}
        <span className={clsx("text-[9px]", active ? "opacity-100" : "opacity-0")}>
          {dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}
